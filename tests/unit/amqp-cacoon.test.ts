/**
 * Note, this test-suite should be called with mocha's "--exit" parameter so it stops the process once
 * all tests run. Otherwise, mocha will wait for all processes to end before exiting.
 */

import { expect } from 'chai';
import 'mocha';
import simple from 'simple-mock';
import AmqpCacoon, {
  IAmqpCacoonConfig,
  ChannelWrapper,
  ConsumeMessage,
  ConfirmChannel,
  ConsumeBatchMessages,
  ConsumerBatchOptions,
} from '../../src';

// Change the fullHostName below also if you change any of the config values!
const fullHostName = 'amqp://valtech:iscool@localhost:5672';
const config: any = {
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
    // Queue
    testQueue: 'test-queue',
  },
};

import log4js from 'log4js';
import { ConsumerOptions } from '../../build';

let logger = log4js.getLogger();
logger = log4js.getLogger('synchronous');
logger.level = 'off';

describe('Amqp Cacoon', () => {
  let amqpCacoonConfig: IAmqpCacoonConfig = {
    protocol: config.messageBus.protocol,
    username: config.messageBus.username,
    password: config.messageBus.password,
    host: config.messageBus.host,
    port: config.messageBus.port,
    connectionString: config.messageBus.connectionString,
    amqp_opts: {
      // These are amqp conn manager options
      heartbeatIntervalInSeconds: 5, // Default
      reconnectTimeInSeconds: 5, // Default
      // These should be passed to the underlying amqplib
      connectionOptions: {
        ca: [],
      },
    },
    providers: {
      logger: logger,
    },
    onChannelConnect: async function (channel: ConfirmChannel) {
      if (channel) {
        await channel.assertQueue(config.messageBus.testQueue);
        await channel.purgeQueue(config.messageBus.testQueue);
      }
    },
  };

  afterEach(() => {
    // After each test, clear out any MOCKs.
    simple.restore();
  });

  // Just make sure it initializes
  it('Constructor: Initializes and important config items are set properly.', () => {
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    expect(
      amqpCacoon.fullHostName,
      'fullHostName was not set property in the underlying library!'
    ).to.equal(fullHostName);
    expect(
      amqpCacoon.amqp_opts,
      'fullHostName was not set property in the underlying library!'
    ).to.equal(amqpCacoonConfig.amqp_opts);
  });

  it('Constructor: Connection string without vhost is correct', () => {
    let amqpCacoon = new AmqpCacoon({
      ...amqpCacoonConfig,
    });
    expect(
      amqpCacoon.fullHostName,
      'fullHostName was not set property in the underlying library!'
    ).to.equal(fullHostName);
  });

  it('Constructor: Connection string with vhost is correct', () => {
    const vhost = 'testvhost';
    let amqpCacoon = new AmqpCacoon({
      ...amqpCacoonConfig,
      ...{ vhost },
    });
    expect(
      amqpCacoon.fullHostName,
      'fullHostName was not set property in the underlying library!'
    ).to.equal(fullHostName + `/${vhost}`);
  });

  it('getConsumerChannel() - returns a channelWrapper', async () => {
    let amqpCacoon: any;
    try {
      amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
      // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
      // for this test!)
      simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
      // Now get a channel and make sure we get one!
      let channelWrapper = await amqpCacoon.getConsumerChannel();
      expect(channelWrapper, 'Is undefined').to.not.be.undefined;
      expect(channelWrapper, 'Is null').to.not.be.null;
      // TODO: check for onBrokerConnect & onBrokerDisconnect wired up?
      // TODO: check for onChannelConnect wired up?
      // End the test
      return;
    } catch (e) {
      throw e;
    }
  });

  it('getPublishChannel() - channel is returned', async () => {
    let amqpCacoon: any;
    try {
      amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
      // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
      // for this test!)
      simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
      // Now get a channel and make sure we get one!
      let channelWrapper = await amqpCacoon.getPublishChannel();
      expect(channelWrapper, 'Is undefined').to.not.be.undefined;
      expect(channelWrapper, 'Is null').to.not.be.null;
      // TODO: check for onBrokerConnect & onBrokerDisconnect wired up?
      // TODO: check for onChannelConnect wired up?
      // End the test
      return;
    } catch (e) {
      throw e;
    }
  });

  it('publish - method calls the right underlying method and passes the correct arguments', async () => {
    try {
      // Instantiate AMQP Cacoon
      let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
      // Mock 'getPublishChannel' form the underlying Cacoon (we don't really want to connect or open a channel
      // for this test!)
      simple.mock(amqpCacoon, 'getPublishChannel').resolveWith({});
      // Get our ChannelWrapper so we can mock some calls
      let channelWrapper = await amqpCacoon.getPublishChannel();
      // Mock 'publish' form the underlying AMQP Connection Manager
      simple.mock(channelWrapper, 'publish').resolveWith(null);

      // Setup some data to Publish
      const exchangeToPub = 'someExchange';
      const routingKeyToPub = 'someQueueName as Routing Key';
      const messageToPub = 'someMessage';
      const bufferToPub = Buffer.from(messageToPub);
      const optionsToPub = {};
      // Publish (note, we have a MOCK on .publish so we won't actually publish!)
      await amqpCacoon.publish(
        exchangeToPub,
        routingKeyToPub,
        bufferToPub,
        optionsToPub
      );
      // Assert that we called the underlying publish with the right inputs
      expect(
        channelWrapper.publish.callCount,
        'publish method was never called!'
      ).to.equal(1);
      expect(
        channelWrapper.publish.lastCall.args[0],
        'publish method received mismatched "exchange" parameter!'
      ).to.equal(exchangeToPub);
      expect(
        channelWrapper.publish.lastCall.args[1],
        'publish method received mismatched "routingKey" parameter!'
      ).to.equal(routingKeyToPub);
      expect(
        channelWrapper.publish.lastCall.args[2],
        'publish method received mismatched "msgBuffer" parameter!'
      ).to.equal(bufferToPub);
      expect(
        channelWrapper.publish.lastCall.args[3],
        'publish method received mismatched "options" parameter!'
      ).to.equal(optionsToPub);
      // End the test
      return;
    } catch (e) {
      throw e;
    }
  });

  it('registerConsumer() + registerConsumerPrivate() - calls the underlying classes properly', async () => {
    let amqpCacoon: any;
    let testDelayForSimulatedMessageMs = 750;
    try {
      amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
      // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
      // for this test!)
      simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
      // Now get a channel and make sure we get one!
      let channelWrapper = await amqpCacoon.getConsumerChannel();
      expect(channelWrapper, 'Is undefined').to.not.be.undefined;
      expect(channelWrapper, 'Is null').to.not.be.null;
      // Dummy consumer options, not particularly important, just valid type!
      let consumerOptions: ConsumerOptions = {
        consumerTag: '',
        noLocal: false,
        noAck: false,
        exclusive: false,
        priority: 1,
        arguments: '',
      };
      // Prepare a DUMMY handler to receive "new" messages
      let handler = async (
        channel: ChannelWrapper,
        msg: ConsumeBatchMessages
      ) => {
        await Promise.resolve();
      };
      // MOCK amqpCacoon.registerConsumerPrivate since that's as deep as we can go before
      // going inside AMQP Connection Manager or AMQPLIB which we're not testing
      simple.mock(amqpCacoon, 'registerConsumerPrivate').callOriginal();
      // MOCK channel.addSetup since that runs, connects to AMQP, then makes a callback to our consumer!
      // Which we'll just MOCK
      simple.mock(channelWrapper, 'addSetup').resolveWith(channelWrapper);
      // Setup the name for a queue. Not important, just needs to be a string
      const queue = 'someQueue';
      // Now register the consumer
      await amqpCacoon.registerConsumer(queue, handler, consumerOptions);
      // Check to make addSetup was called
      expect(
        channelWrapper.addSetup.callCount,
        'addSetup was not called!'
      ).to.equal(1);
      // Let's check that 'registerConsumerPrivate' was passed the right things
      expect(
        amqpCacoon.registerConsumerPrivate.lastCall.args[0],
        'consume mismatch on "queue" argument'
      ).to.equal(queue);
      expect(
        amqpCacoon.registerConsumerPrivate.lastCall.args[2],
        'consume mismatch on "options" argument'
      ).to.equal(consumerOptions);
      // End the test
      return;
    } catch (e) {
      throw e;
    }
  });

  it('registerConsumerBatch() + registerConsumerPrivate() - calls the underlying classes properly', async () => {
    let amqpCacoon: any;
    let testDelayForSimulatedMessageMs = 750;
    try {
      amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
      // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
      // for this test!)
      simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
      // Now get a channel and make sure we get one!
      let channelWrapper = await amqpCacoon.getConsumerChannel();
      expect(channelWrapper, 'Is undefined').to.not.be.undefined;
      expect(channelWrapper, 'Is null').to.not.be.null;
      // Dummy consumer options, not particularly important, just valid type!
      let consumerBatchOptions: ConsumerBatchOptions = {
        consumerTag: '',
        noLocal: false,
        noAck: false,
        exclusive: false,
        priority: 1,
        arguments: '',
        batching: {
          maxSizeBytes: 0,
          maxTimeMs: 0,
        },
      };
      // Prepare a DUMMY handler to receive "new" messages
      let handler = async (
        channel: ChannelWrapper,
        msg: ConsumeBatchMessages
      ) => {
        await Promise.resolve();
      };
      // MOCK amqpCacoon.registerConsumerPrivate since that's as deep as we can go before
      // going inside AMQP Connection Manager or AMQPLIB which we're not testing
      simple.mock(amqpCacoon, 'registerConsumerPrivate').callOriginal();
      // MOCK channel.addSetup since that runs, connects to AMQP, then makes a callback to our consumer!
      // Which we'll just MOCK
      simple.mock(channelWrapper, 'addSetup').resolveWith(channelWrapper);
      // Setup the name for a queue. Not important, just needs to be a string
      const queue = 'someQueue';
      // Now register the consumer
      await amqpCacoon.registerConsumerBatch(
        queue,
        handler,
        consumerBatchOptions
      );
      // Check to make addSetup was called
      expect(
        channelWrapper.addSetup.callCount,
        'addSetup was not called!'
      ).to.equal(1);
      // Let's check that 'registerConsumerPrivate' was passed the right things
      expect(
        amqpCacoon.registerConsumerPrivate.lastCall.args[0],
        'consume mismatch on "queue" argument'
      ).to.equal(queue);
      expect(
        amqpCacoon.registerConsumerPrivate.lastCall.args[2],
        'consume mismatch on "options" argument'
      ).to.equal(consumerBatchOptions);
      // End the test
      return;
    } catch (e) {
      throw e;
    }
  });
});
