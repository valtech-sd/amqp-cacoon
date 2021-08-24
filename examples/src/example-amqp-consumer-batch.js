/**
 * example-amqp-consumer
 *
 * This example demonstrates how to use AMQP Cacoon to start up an AMQP Consumer, using
 * a BATCH. This means that your consumer callback will not fire for EACH messagge, but will
 * instead fire in groups that you determine either by time or bytes!
 *
 * DEPENDENCIES:*
 * - AMQP Cacoon - is a package that manages connections to RabbitMQ.
 * - log4js - is a generic logger for NodeJS. See the file ./providers/custom_logger.js for a very
 *   example of log4js as a replacement to console.log.
 *
 * IMPORTANT * IMPORTANT * IMPORTANT: BROKER AUTHENTICATION AND TLS
 *
 * This example relies on a secrets.json file for the username, password and CA Certificate name to
 * use when connecting to RabbitMQ. In order to run this example, be sure that you have:
 * - An AMQP RabbitMQ Broker listening on AMQP or AMQPS accessible from your workstation.
 * - Edited amqp-config.js and selected the protocol and port you'll be using to connect to RabbitMQ.
 * - Copy the file ./examples/src/conf/secrets-template.json to secrets.json.
 * - Edit the username, password and CA certificate values in that file to match your broker settings.
 *
 * If you don't have a RabbitMQ broker setup, check out our other repo that provides you a way to stand up
 * a broker using Docker Compose. See https://github.com/valtech-sd/Docker-RabbitMQ.
 *
 */

// Bring in Core Node Dependencies
const util = require('util');

// Bring in Package Dependencies
const { default: AmqpCacoon } = require('amqp-cacoon');

// Bring in other Application Specific dependencies
const logger = require('./custom_logger');

// Bring in our AMQP Broker configuration
const amqpConfig = require('./conf/amqp-config');

// Since the AMQP Input requires an AMQP Cacoon object, let's start by creating that.
// AMQP Cacoon is a library that makes it easy to connect to RabbitMQ.
let amqpCacoon = new AmqpCacoon({
  protocol: amqpConfig.protocol,
  username: amqpConfig.username,
  password: amqpConfig.password,
  host: amqpConfig.host,
  port: amqpConfig.port,
  amqp_opts: amqpConfig.amqp_opts,
  providers: {
    logger: logger,
  },
  // Important - onChannelConnect will ensure a certain configuration exists in RMQ.
  // This might not be needed in environments where RMQ is setup by some other process!
  onChannelConnect: async (channel) => {
    try {
      // Notice all of these are done in sequence with AWAIT. This is so that each
      // operation can depend on the prior operation having finished. This is important
      // when binding Queues to Exchanges, for example because you need both the
      // Exchange and Queue to exist prior to trying to bind them together.

      // Make sure we have our example queue
      await channel.assertQueue(amqpConfig.exampleQueue, {
        autoDelete: true,
        durable: false,
      });
      // Make sure we have our example exchange
      await channel.assertExchange(amqpConfig.exampleExchange, 'direct', {
        autoDelete: true,
        durable: false,
      });
      // Bind the new Exchange and Queue together
      await channel.bindQueue(
        amqpConfig.exampleQueue,
        amqpConfig.exampleExchange,
        '' // Empty routing key to match anything published without one! (Messages published into this
        // exchange without a routing key WILL be sent to the bound queue.
      );
    } catch (ex) {
      logger.error(`onChannelConnect ERROR: ${util.inspect(ex.message)}`);
      // If we can't complete our connection setup, we better throw because it's unlikely we'll
      // be able to properly consume messages!
      throw ex;
    }
  },
});

// And finally, we can set up, let's create a main method to hold our logic...

async function main() {
  // Connects and sets up a subscription channelWrapper
  await amqpCacoon.getConsumerChannel();

  // Register a consumer to consume single message at a time
  await amqpCacoon.registerConsumerBatch(
    amqpConfig.exampleQueue,
    async (channelWrapper, msgBatch) => {
      try {
        logger.info(`Message Batch Count: ${msgBatch.messages.length}`);
        // ... Do other processing here
        // Loop through the batch and handle each as needed
        for (let msg of msgBatch.messages) {
          logger.info(`Message content: ${msg.content.toString()}`);
        }
        // Once processing is done, ACK them all!
        // This requires a bit of planning on your application, of course, to avoid duplicate processing!
        msgBatch.ackAll();
      } catch (e) {
        // Some error happened in our handling of the message batch.
        // The bet practice is to NACK all the messages so that some other process retries them!
        // This requires a bit of planning on your application, of course, to avoid duplicate processing!
        msgBatch.nackAll();
      }
    },
    {
      batching: {
        maxSizeBytes: 1000, // A total of 1,000 Bytes will force consume
        maxTimeMs: 5000, // 5000ms = 5s elapsed will for a consume
      },
    }
  );
}

// Run the Example!
logger.info(
  `About to register a consumer for your AMQP host "${amqpConfig.host}"`
);

main()
  .then(() => {
    // Ok, we should have a consumer ready!
    console.info(
      `You should now have an Exchange "${amqpConfig.exampleExchange}" & Queue "${amqpConfig.exampleQueue}" on your AMQP host.`
    );
    console.info(
      `Publish messages to either the Exchange or Queue to consume the messages by this consumer - EVERY FEW SECONDS! CTRL+C will quit this app.`
    );
    logger.info(
      `An easy way to send messages is to open one of the example order files, then paste the contents into the RabbitMQ console. Under QUEUES, click into "${amqpConfig.exampleQueue}" and notice there is a publish message section. Paste the contents of one of the order files in there and click PUBLISH MESSAGE.`
    );
  })
  .catch((e) => {
    // Uh Oh... something went wrong
    console.error(`Something bad happened: ${e.message}`);
  });
