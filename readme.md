# AmqpCacoon

<p align="center">
  <img height='300' src="./assets/amqp_cacoon_2.png">
</p>

[![CircleCI](https://circleci.com/gh/valtech-sd/amqp-cacoon.svg?style=svg)](https://circleci.com/gh/valtech-sd/amqp-cacoon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg)](https://github.com/ellerbrock/typescript-badges/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Overview

This is a basic library to provide amqp support. Originally, this library was a wrapper around amqplib. It has since been updated to work with [node-amqp-connection-manager](https://github.com/jwalton/node-amqp-connection-manager), which provides support for behind-the-scenes retries on network failure. Node-amqp-connection-manager guarantees receipt of published messages and provides wrappers around potentially non-persistent channels.

## Features

- Simple interace around `node-amqp-manager`
- ~~Publish flow control included out of the box (Wait for drain event if we can't publish)~~
- timeout if drain event does not occurs after some amount of time when channel is not ready to receive a publish~. As of 9/26, the publish on drain functionality has been removed, as `node-amqp-manager` does not support it at this time (pending a bugfix).
- Consume single or batch of messages
- Automatically handles reconnect if AMQP connection is lost and re-established
- Caches published messages if they are published while AMQP is disconnected

## Requirements to tests

1. docker
2. docker-compose

If using macos `brew cask install docker` should install both docker and docker-compose

## Running Tests

1. Start docker-compose - This starts RabbitMq
   ```
   docker-compose up -d
   ```
2. Install node modules (This also loads local modules from our own repositories)
   ```
   npm install
   ```
3. Run tests
   ```
   npm run test
   ```

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
  amqp_opts: {},
  providers: {
    logger: logger,
  },
});
```

### Publish

This allows you to publish a message

```javascript
let channel = await amqpCacoon.getPublishChannel(); // Connects and sets up a publish channel

// Create queue and setup publish channel
channel.assertQueue(config.messageBus.testQueue);

// Publish
await amqpCacoon.publish(
  '', // Publish directly to queue
  config.messageBus.testQueue,
  Buffer.from('TestMessage')
);
```

### Consume Single Message

This will allow use to consume a single message.

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

### Consume Message Batch

This allows you to wait until either some time has elapsed or a specified message size has been exceeded before the messages are consumed

```javascript
// Consume batch of message at a time. Configuration for time based or size based batching is provided
amqpCacoon.registerConsumerBatch(
  config.messageBus.testQueue,
  async (channel: Channel, msg: ConsumeBatchMessages) => {
    try {
      console.log('Messsage content', msg.content.toString());
      // ... Do other processing here
      msg.ackAll() // To ack all messages
    } catch (e) {
      msg.nackAll() // To nack all messages
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

## Dealing With Channels via ChannelWrapper

This library exposes node-amqp-connection-manager's ChannelWrapper when you call either `getConsumerChannel` or `getPublishChannel`. Instead of exposing the Amqp Channel directly (which may or may not be valid depending on the network status), AmqpConnectionManager provides a ChannelWrapper class as an interface to interacting with the underlying channel. Most functions that can be performed on an AmqpLib `Channel` can be performed on the `ChannelWrapper`, including `ackAll`, `nackAll`, etc. though they are Promise-based. See [AMQPConnectionManager's documentation](https://github.com/jwalton/node-amqp-connection-manager) for more info, as well as the underlying [amqplib docs](https://www.npmjs.com/package/amqplib).

Just a couple thing that you should remember to do.

1. Remember to ack or nack on all messages.
2. An alternative is to pass an option into the `registerConsumer` to not require an ack (noAck). The problem with this is that if your application is reset or errors out, you may loose the message or messages.


## Amqp-connection-manager Setup function
AmqpConnectionManager allows a setup function to be passed in its configuration, or added to a ChannelWrapper at any point. This function can be used with callbacks or Promises and direclty exposes the underlying AMQP channel as a ConfirmChannel (an extension of Channel) (since we know it is valid at that point). The setup function is useful for asserting queues and performing other necessary tasks that must be completed once a valid connection to amqp is made. Again, see [AMQPConnectionManager's documentation](https://github.com/jwalton/node-amqp-connection-manager) for more details.
