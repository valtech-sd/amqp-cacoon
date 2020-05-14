# AmqpCacoon

<p align="center">
  <img height='300' src="./assets/amqp_cacoon_2.png">
</p>

## Overview

This is a basic library to provide amqp support. This library is a wrapper around amqplib and makes amqp easier to work with.

## Features

- Simple interace around amqplib
- Publish flow control included out of the box (Wait for drain event if we can't publish)
- timeout if drain event does not occure after some amount of time when channel is not ready to receive a publish

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

## Dealing With Channels

This library expose amqplib channel when you call either `getConsumerChannel` or `getPublishChannel`. The channel is also exposed when registering a consumer. To learn more about that api see documentation for [amqplib](https://www.npmjs.com/package/amqplib). Just a couple thing that you should remember to do.

1. Remember to ack or nack on all messages.
2. An alternative is to pass an option into the `registerConsumer` to not require an ack (noAck). The problem with this is that if your application is reset or errors out, you may loose the message or messages.


