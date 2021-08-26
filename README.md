# AmqpCacoon 

<p align="center">
  <img height='300' src="./assets/amqp_cacoon_2.png">
</p>

[![CircleCI](https://circleci.com/gh/valtech-sd/amqp-cacoon.svg?style=svg)](https://circleci.com/gh/valtech-sd/amqp-cacoon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg)](https://github.com/ellerbrock/typescript-badges/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Overview

This is a basic library to provide amqp support. This library is a wrapper around [node-amqp-connection-manager](https://github.com/jwalton/node-amqp-connection-manager) which wraps 
amqplib.

## Features

AMQP Cacoon, in combination with AMQP Connection Manager:

- provides support for behind-the-scenes retries on network failure:
  - automatically handles reconnect if AMQP connection is lost and re-established.
  - caches published messages if they are published while AMQP is disconnected.
- guarantees receipt of published messages and provides wrappers around potentially non-persistent channels.
- allows consuming single or a batch of messages.

## Dependencies

This version of AMQP Cacoon has been tested with:

* NodeJS v16
  https://nodejs.org/en/about/releases/
* AMQP Connection Manager v3.2
  https://github.com/jwalton/node-amqp-connection-manager
* AMQPLIB v0.8
  http://www.squaremobius.net/amqp.node/
  
It is possible the package functions correctly with older versions of node and other dependencies, though these might
be untested.

## Simple Usage

### Connect

This allows you to connect to an amqp server

```javascript
const config = {
  messageBus: {
    // Protocol should be "amqp" or "amqps"
    protocol: 'amqp',
    // Username + Password on the RabbitMQ host
    username: 'valtech',
    password: 'iscool',
    // Host
    host: 'localhost',
    // Port
    port: 5672,
    // Queue setup
    testQueue: 'test-queue',
  },
};

let amqpCacoon = new AmqpCacoon({
  protocol: config.messageBus.protocol,
  username: config.messageBus.username,
  password: config.messageBus.password,
  host: config.messageBus.host,
  port: config.messageBus.port,
  // AMQP Options which should conform to <AmqpConnectionManagerOptions>
  amqp_opts: {
    // Pass options to node amqp connection manager (a wrapper around AMQPLIB)
    // See connect(urls, options) in https://www.npmjs.com/package/amqp-connection-manager
    heartbeatIntervalInSeconds: 5, // Default
    reconnectTimeInSeconds: 5, // Default

    // Pass options into the underlying AMQPLIB.
    // See AMQPLIB SocketOptions https://www.squaremobius.net/amqp.node/channel_api.html#connect
    connectionOptions: {
      // If using AMQPS, we need to pass the contents of your CA file as a buffer into the broker host via amqp_opts.
      // This is facilitated for you here. Just copy your CA CERT file to the same location as this config file
      // then edit the secrets.json file to enter the NAME of your CA CERT file! Don't forget to set 'amqps' and
      // 'port' to the corresponding AMQPS values also in this configuration!
      // See https://www.squaremobius.net/amqp.node/ssl.html for more details.
      ca:
        config.messageBus.port === 'amqps'
          ? [
            fs.readFileSync(
              __dirname + '/' + secrets.amqpCACertName || 'ca_certificate.pem'
            ),
          ]
          : null,
    },
  },
  providers: {
    logger: logger,
  },
});
```

> **Note:** See the [RabbitMQ Setup](#rabbitmq-setup) section below for how to set up Exchanges and Queues once your
> connection is established.

### Publishing Messages

Once you have an active amqpCaccon object, here is an example of how to publish a message.

```javascript
// Connects and sets up a publish channel
let channel = await amqpCacoon.getPublishChannel();

// Publish
await amqpCacoon.publish(
    // 1  
    '', 
    // 2
    config.messageBus.testQueue, 
    // 3
    Buffer.from('TestMessage')
);
```

Note:

1. This is the exchange name to publish into. Leaving this blank publishes to the AMQP Default Exchange.
1. This is the routing key for the message. If you publish to the AMQP Default Exchange, then the Routing Key
   needs to be the name of a Queue which the default Exchange will route the message into.
   If you're publishing to a named Exchange (which is more flexible) then you can still pass a routing key
   but be sure to BIND that exchange to one or more queues based on the routing key so that the exchnage knows
   how to route your messages! Learn more about routing here: https://www.rabbitmq.com/tutorials/tutorial-four-javascript.html
1. This is the message to publish. Notice it must be a Buffer. 

> **Note:** Please see **./examples/example-amqp-publish.js** for a complete example.

### Consume Single Message

This is an example of how to consume a single message.

```javascript
let channel = await amqpCacoon.getConsumerChannel(); // Connects and sets up a subscription channel

// Create queue
channel.assertQueue(config.messageBus.testQueue);

// Consume single message at a time
amqpCacoon.registerConsumer(
  config.messageBus.testQueue,
  async (channel: Channel, msg: ConsumeMessage) => {
    try {
      console.log('Messsage content', msg.content.toString());
      // ... Do other processing here
      channel.ack(msg) // To ack a messages
    } catch (e) {
      channel.nack(msg) // To ack a messages
    }
  }
);
```

> **Note:** Please see **./examples/example-amqp-consumer.js** for a complete example.

### Consume Message Batch

When consuming messages, instead of one at a time, you can choose to have your callback passed in a batch. This feature 
allows you to wait until either some time has elapsed or a specified message data size has been exceeded before the 
messages are turned over to your callback.

```javascript
// Consume batch of message at a time. Configuration for time based or size based batching is provided
amqpCacoon.registerConsumerBatch(
  config.messageBus.testQueue,
  async (channel: Channel, batch: ConsumeBatchMessages) => {
    try {
      console.log(`Messsages in the bactch: ${batch.messages.length}`);
      // ... Do other processing here. Note `batch.messages` is an array of messages!
       batch.ackAll() // To ack all messages
    } catch (e) {
       batch.nackAll() // To nack all messages
    }
  },
  {
    batching: {
      maxTimeMs: 60000, // Don't provide messages to the callback until at least 60000 ms have passed
      maxSizeBytes: 1024 * 1024 * 2, // 1024 * 1024 * 2 = 2 MB -don't provide message to the callback until 2 MB of data have been received
    }
  }
);
```

> **Note:** Please see **./examples/example-amqp-consumer-batch.js** for a complete example.

Note that in practice, all messages are fetched by AMQP Cacoon from the broker as soon as they're released by the broker. 
However, AMQP Cacoon batches the contents until the time or data limit is reached, then your callback is handed over 
the messages for processing. Note that AMQP Cacoon will not ACK nor NACK the messages until your callback decides! So,
you'll see the messages accumulate in RabbitMQ until your callback is called, then batches will be removed from RMQ
as you ACK them. The best practice is to write your application to either ACK or NACK all the messages in a batch, 
however, it is possible to ACK, NACK individual messages (though that is not demonstrated here.)

## Dealing With Channels via ChannelWrapper

This library exposes node-amqp-connection-manager's ChannelWrapper when you call either `getConsumerChannel` or 
`getPublishChannel`. Instead of exposing the Amqp Channel directly (which may or may not be valid depending on the 
network status), AmqpConnectionManager provides a ChannelWrapper class as an interface to interacting with the 
underlying channel. Most functions that can be performed on an AmqpLib `Channel` can be performed on the 
`ChannelWrapper`, including `ackAll`, `nackAll`, etc. though they are Promise-based. 
See [AMQPConnectionManager's documentation](https://github.com/jwalton/node-amqp-connection-manager) for more info, 
as well as the underlying [amqplib docs](https://www.npmjs.com/package/amqplib).

Note:

1. Remember to ack or nack on all messages. This is a standard message bus pattern.
1. An alternative is to pass an option into the `registerConsumer` to not require an ack (noAck). The problem with this 
   is that if your application is reset or errors out, you may lose the message or messages.

## RabbitMQ Setup

AMQP Caccon exposes the underlying Amqp Connection Manager setup function which allows a setup callback to be passed 
in the configuration, or added to a ChannelWrapper at any point. This function can be used with callbacks or Promises 
and directly exposes the underlying AMQP channel as a ConfirmChannel (an extension of Channel) (since we know it is 
valid at that point). The setup function is useful for asserting queues and performing other necessary tasks that must 
be completed once a valid connection to amqp is made. See [AMQPConnectionManager's documentation](https://github.com/jwalton/node-amqp-connection-manager) for more details.

Here are typescript and javascript examples of this in practice:

```typescript
  let amqpCacoonConfig: IAmqpCacoonConfig = {
    protocol: config.messageBus.protocol,
    username: config.messageBus.username,
    password: config.messageBus.password,
    host: config.messageBus.host,
    port: config.messageBus.port,
    connectionString: config.messageBus.connectionString,
    amqp_opts: {},
    providers: {
      logger: logger,
    },
    // 1
    onChannelConnect: async function (channel: ConfirmChannel) {
      if (channel) {
        // 2
        await channel.assertQueue(config.messageBus.testQueue);
      }
    },
  };
```

```javascript
  let amqpCacoonConfig = {
    protocol: config.messageBus.protocol,
    username: config.messageBus.username,
    password: config.messageBus.password,
    host: config.messageBus.host,
    port: config.messageBus.port,
    connectionString: config.messageBus.connectionString,
    amqp_opts: {},
    providers: {
      logger: logger,
    },
    // 1
    onChannelConnect: async function (channel) {
      if (channel) {
        // 2
        await channel.assertQueue(config.messageBus.testQueue);
      }
    },
  };
```

Note that in both examples:
1. You add a callback in your amqpCacoonConfig which will be called once the connection to RabbitMQ is established passing
   in a channel into the callback.
1. You then use that channel to perform `assertQueue()`, `assertExhange()`, `bindQueue()` and other setup
   operations.

## Run the Examples

The directory **./examples/src** contains several examples demonstrating the features of AMQP Cacoon.

To run the examples:

1. Install node modules
  ```bash
  cd ./examples
  npm i
  ```

1. Make sure that you have an AMQP broker like RabbitMQ running, as noted in the comments at the top of the example files in `examples/src`.

1. Run any one of the specific examples
  ```bash
  node ./example-amqp-publish.js
  ```

## Running Tests for this Repo

Note that all the tests for this REPO are UNIT TESTS that do not require an actual AMQP host to be
setup. Consequently, the tests verify that the AMQP Cacoon wrappers are properly calling the underlying
AMQPLIP and NODE AMQP MANAGER libraries. For a more "real world" test, see [Run the Examples](#run-the-examples).

1. Install node modules (This also loads local modules from our own repositories)

   ```bash
   npm install
   ```
1. Run tests

   ```bash
   npm run test
   ```

## Roadmap 

- TODO: Add an example of ConsumeBatch where individual messages are ACK/NACK.
- PENDING: Timeout if drain event does not occur after some amount of time when channel is not ready to receive a 
  publish. As of 09/2020, the publish-on-drain functionality has been removed, as `node-amqp-manager` does not support 
  it at this time (pending a bugfix?). This requires further research and testing. See https://github.com/valtech-sd/amqp-cacoon/issues/20.
  
