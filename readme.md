# AmqpCacoon

<p align="center">
  <img height='300' src="./assets/amqp_cacoon_2.png">
</p>

## Caution

WIP: Documetation is very much a work in progress.

## Overview

This is a basic library to provide amqp support. This library is a wrapper around amqplib and makes amqp easier to work with.

## Features

- Simple interace around amqplib
- Publish flow control included out of the box (Wait for drain event if we can't publish)
- TODO timeout if drain event does not occure after some amount of time

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

## Usage

### Connect and publish

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

### Connect and Consume

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

  let channel = await amqpCacoon.getConsumerChannel(); // Connects and sets up a subscription channel

  // Create queue
  channel.assertQueue(config.messageBus.testQueue);

  // Consume
  amqpCacoon.registerConsumer(
    config.messageBus.testQueue,
    async (channel: Channel, msg: ConsumeMessage) => {
      console.log("Messsage content", msg.content.toString());
    }
  );
```
