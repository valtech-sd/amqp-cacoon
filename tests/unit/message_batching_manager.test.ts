import { expect } from 'chai';
import 'mocha';
import simple from 'simple-mock';
import log4js from 'log4js';

// Setup our logger
let logger = log4js.getLogger();
logger = log4js.getLogger('synchronous');
logger.level = 'off';

// Import the class we want to test
import MessageBatchingManager from '../../src/helpers/message_batching_manager';

// Import some classes from AmqpCacoon so we don't have to create complex objects
import AmqpCacoon, {
  IAmqpCacoonConfig,
  ChannelWrapper,
  ConsumeMessage,
  ConfirmChannel,
  ConsumeBatchMessages,
  ConsumerBatchOptions,
} from '../../src';

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

describe('Message Batching Manager', () => {
  // Config AMQP Cacoon - This object is not super important for this test suite. It just needs
  // to be in the right format! We don't actually connect to an RMQ Host as we MOCK all calls!
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
        // Nothing here is needed for now
      }
    },
  };

  afterEach(() => {
    // After each test, clear out any MOCKs.
    simple.restore();
  });

  // Test the various methods of the consuming in batch

  it('resetMessages clears the buffer.', () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // not important in this test
      });

    // Create a dummy message object (10 bytes)
    let aMessage: ConsumeMessage = createDummyMessageOfLength(10);
    // Add a few messages to the buffer (3 x 10 = 30 bytes)
    messageBatchingHandler.addMessage(aMessage);
    messageBatchingHandler.addMessage(aMessage);
    messageBatchingHandler.addMessage(aMessage);
    // Verify they're present
    expect(messageBatchingHandler.getMessageCount(), '').to.equal(3);
    expect(messageBatchingHandler.getBufferSize(), '').to.equal(30);
    // Clear the list of messages
    messageBatchingHandler.resetMessages();
    // Now verify the storage is cleared out and both properties are now zero
    expect(messageBatchingHandler.getMessageCount(), '').to.equal(0);
    expect(messageBatchingHandler.getBufferSize(), '').to.equal(0);
  });

  it('addMessage increments the count and byte size of the class properties that hold these.', () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // not important in this test
      });

    // Create a dummy message object
    let aMessage1: ConsumeMessage = createDummyMessageOfLength(200);
    let aMessage2: ConsumeMessage = createDummyMessageOfLength(50);

    // Add a few messages to the buffer
    messageBatchingHandler.addMessage(aMessage1);
    messageBatchingHandler.addMessage(aMessage2);
    // Verify they're present
    expect(messageBatchingHandler.getMessageCount(), '').to.equal(2);
    expect(messageBatchingHandler.getBufferSize(), '').to.equal(250);
  });

  it('ackMessageList calls ack on all messages', async () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // not important in this test
      });

    // Create a message list with a few messages of varying lengths
    let aMessageList: Array<ConsumeMessage> = [
      createDummyMessageOfLength(20),
      createDummyMessageOfLength(15),
      createDummyMessageOfLength(30),
    ];

    // Setup an instance of AMQP Cacoon
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
    // for this test!)
    simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
    // Get a channelWrapper
    let channelWrapper = await amqpCacoon.getPublishChannel();
    // Mock channel.ack so we don't actually go into the underlying libraries
    simple.mock(channelWrapper, 'ack').resolveWith({});
    // Test the batch ack handling
    messageBatchingHandler.ackMessageList(channelWrapper, aMessageList);
    // Check to make sure that ack was called the same as the number of messages we have
    expect(
      channelWrapper.ack.callCount,
      'Ack was not called as many times as needed!'
    ).to.equal(aMessageList.length);
    // Check to make sure that each call happened with the right array item
    for (let i = 0; i < aMessageList.length; i++) {
      expect(channelWrapper.ack.calls[i].args[0]).to.equal(aMessageList[i]);
    }
    // Close AMOP Cacoon
    amqpCacoon.close();
    // End the test
    return;
  });

  it('nackMessageList calls nack on all messages', async () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // not important in this test
      });

    // Create a message list with a few messages of varying lengths
    let aMessageList: Array<ConsumeMessage> = [
      createDummyMessageOfLength(20),
      createDummyMessageOfLength(15),
      createDummyMessageOfLength(30),
    ];

    // Setup an instance of AMQP Cacoon
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
    // for this test!)
    simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
    // Get a channelWrapper
    let channelWrapper = await amqpCacoon.getPublishChannel();
    // Mock channel.ack so we don't actually go into the underlying libraries
    simple.mock(channelWrapper, 'nack').resolveWith({});
    // Test the batch ack handling
    messageBatchingHandler.nackMessageList(channelWrapper, aMessageList, false);
    // Check to make sure that ack was called the same as the number of messages we have
    expect(
      channelWrapper.nack.callCount,
      'Nack was not called as many times as needed!'
    ).to.equal(aMessageList.length);
    // Check to make sure that each call happened with the right array item
    for (let i = 0; i < aMessageList.length; i++) {
      expect(channelWrapper.nack.calls[i].args[0]).to.equal(aMessageList[i]);
    }
    // Close AMOP Cacoon
    amqpCacoon.close();
    // End the test
    return;
  });

  it('finalizeMessages returns an object AND clears the instances properties.', () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // For now, test skip the NACK, so NO NACK on FAIL!
      });

    // Create a dummy message objects
    let aMessage1: ConsumeMessage = createDummyMessageOfLength(200);
    let aMessage2: ConsumeMessage = createDummyMessageOfLength(50);
    // Add a few messages to the buffer
    messageBatchingHandler.addMessage(aMessage1);
    messageBatchingHandler.addMessage(aMessage2);
    // Verify they're present
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(2);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(250);
    // Call finalizeMessages and verify the right counts come over
    let finalizeMessagesReturn = messageBatchingHandler.finalizeMessages();
    // Verify we received the right stuff
    expect(
      finalizeMessagesReturn.unackedMessageList.length,
      'finalizeMessages message count mismatch.'
    ).to.equal(2);
    expect(
      finalizeMessagesReturn.bufferSize,
      'finalizeMessages buffer size mismatch.'
    ).to.equal(250);
    // Verify the instance is back to no messages and zero buffer
    expect(
      messageBatchingHandler.getMessageCount(),
      'After finalizeMessages, message count mismatch.'
    ).to.equal(0);
    expect(
      messageBatchingHandler.getBufferSize(),
      'After finalizeMessages, buffer size mismatch.'
    ).to.equal(0);
  });

  it('sendBufferedMessages calls handler with the proper objects.', async () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 0,
        maxTimeMs: 0,
        skipNackOnFail: true, // For now, test skip the NACK, so NO NACK on FAIL!
      });
    // Create a dummy message objects
    let aMessage1: ConsumeMessage = createDummyMessageOfLength(100);
    let aMessage2: ConsumeMessage = createDummyMessageOfLength(25);
    let messageCount = 2;
    let messageBytes = 125;
    // Add a few messages to the buffer
    messageBatchingHandler.addMessage(aMessage1);
    messageBatchingHandler.addMessage(aMessage2);
    // Verify they're present
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(messageCount);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(messageBytes);

    // Setup an instance of AMQP Cacoon
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
    // for this test!)
    simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
    // Get a channelWrapper
    let channelWrapper = await amqpCacoon.getPublishChannel();
    // Create a dummy stub handler (it will get mocked next!)
    let handler = async (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => {
      await Promise.resolve();
    };
    // Wrap the handler in a SPY
    handler = simple.spy(handler);

    // Test our sendBufferedMessages
    await messageBatchingHandler.sendBufferedMessages(channelWrapper, handler);
    // Verify the handler is called with the proper stuff
    expect(handler.callCount, 'sub handler not called!').to.equal(1);
    // Verify the handler received the right data
    expect(
      handler.lastCall.args[0],
      'sub handler called with bad argument "channel"'
    ).to.equal(channelWrapper);
    expect(
      handler.lastCall.args[1].totalSizeInBytes,
      'sub handler called with bad argument "messages.totalSizeInBytes"'
    ).to.equal(messageBytes);
    expect(
      handler.lastCall.args[1].messages.length,
      'sub handler called with bad argument "messages.messages"'
    ).to.equal(messageCount);
    // Close AMOP Cacoon
    amqpCacoon.close();
    // Exit the test
    return;
  });

  it('handleMessageBuffering calls handler with the proper objects when buffer size limit is exceeded.', async () => {
    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 500, // Buffer 500 bytes
        maxTimeMs: 60000, // Buffer 2000 ms - something long for now since we're testing for BYTES!!
        skipNackOnFail: true, // For now, test skip the NACK, so NO NACK on FAIL!
      });
    // Create some dummy message objects under the max size
    let aMessage1: ConsumeMessage = createDummyMessageOfLength(100);
    let aMessage2: ConsumeMessage = createDummyMessageOfLength(25);
    let aMessage3: ConsumeMessage = createDummyMessageOfLength(25);
    // Set this one to maxSizeBytes so it forces the SEND
    let aMessage4: ConsumeMessage = createDummyMessageOfLength(500);
    let messageCount = 3;
    let messageBytes = 150; // Important that this is LESS than maxSizeBytes earlier in the test!!
    let messageCountAll = 4; // Count of ALL the messages in the end.
    let messageBytesAll = 650; // Important that this is the sum of ALL the messages.
    // Add a few messages to the buffer (but leave one NOT added which we'll pass to handleMessageBuffering)
    messageBatchingHandler.addMessage(aMessage1);
    messageBatchingHandler.addMessage(aMessage2);
    // Verify they're present (only 2 messages and the sum of bytes of message1 + 2)
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(2);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(125);

    // Setup an instance of AMQP Cacoon
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
    // for this test!)
    simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
    // Get a channelWrapper
    let channelWrapper = await amqpCacoon.getPublishChannel();
    // Create a dummy stub handler (it will get mocked next!)
    let handler = async (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => {
      await Promise.resolve();
    };
    // Wrap the handler in a SPY
    handler = simple.spy(handler);

    // Test our handleMessageBuffering, at this stage, we DO NOT expect our mock of sendBufferedMessages to be called!
    await messageBatchingHandler.handleMessageBuffering(
      channelWrapper,
      aMessage3,
      handler
    );
    // Verify we have the one more message (now 3 messages and the sum of the bytes of the first 3)
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(3);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(150);
    // Verify the handler was NOT called!
    expect(handler.callCount, 'sub handler was called!').to.equal(0);
    // Test our handleMessageBuffering, adding the 4th message that exceeds maxSizeBytes
    await messageBatchingHandler.handleMessageBuffering(
      channelWrapper,
      aMessage4,
      handler
    );
    // Verify the handler was called!
    expect(handler.callCount, 'sub handler was called!').to.equal(1);
    // Verify the handler received the right data
    expect(
      handler.lastCall.args[1].totalSizeInBytes,
      'sub handler called with bad argument "messages.totalSizeInBytes"'
    ).to.equal(messageBytesAll);
    expect(
      handler.lastCall.args[1].messages.length,
      'sub handler called with bad argument "messages.messages"'
    ).to.equal(messageCountAll);
    // Verify the instance class now has zero messages and zero bytes! (since a successful Buffer send should
    // perform a reset!
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(0);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(0);
    // Close AMOP Cacoon
    amqpCacoon.close();
    // Exit the test
    return;
  });

  it('handleMessageBuffering calls handler with the proper objects when buffer time limit is exceeded.', async () => {
    // Initialize Message batching manager
    let timeToWaitMs = 750; // Fast so it sends quickly, but still gives us time to check things
    let messageBatchingHandler: MessageBatchingManager =
      new MessageBatchingManager({
        providers: { logger: logger },
        maxSizeBytes: 10000, // Something high so that the bytes don't trigger the send
        maxTimeMs: timeToWaitMs,
        skipNackOnFail: true, // For now, test skip the NACK, so NO NACK on FAIL!
      });
    // Create some dummy message objects under the max size
    let aMessage1: ConsumeMessage = createDummyMessageOfLength(100);
    let messageCountAll = 1; // Count of ALL the messages in the end.
    let messageBytesAll = 100; // Important that this is the sum of ALL the messages.

    // Setup an instance of AMQP Cacoon
    let amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
    // Mock 'amqp.connect' form the underlying Cacoon (we don't really want to connect or open a channelWrapper
    // for this test!)
    simple.mock(amqpCacoon, 'amqp.connect').resolveWith({});
    // Get a channelWrapper
    let channelWrapper = await amqpCacoon.getPublishChannel();
    // Create a dummy stub handler (it will get mocked next!)
    let handler = async (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => {
      await Promise.resolve();
    };
    // Wrap the handler in a SPY
    handler = simple.spy(handler);

    // Test our handleMessageBuffering, at this stage, we DO NOT expect our mock of sendBufferedMessages to be called!
    // Since TIME should not yet be exceeded
    await messageBatchingHandler.handleMessageBuffering(
      channelWrapper,
      aMessage1,
      handler
    );
    // Verify the handler was NOT called!
    expect(handler.callCount, 'sub handler was called!').to.equal(0);

    // Now let's wait maxTimeMs before we check again
    await new Promise((resolve) => setTimeout(resolve, timeToWaitMs));

    // We waited, verify the handler was called since we expect it should have due to exceeding maxTimeMs
    expect(handler.callCount, 'sub handler was called!').to.equal(1);
    // Verify the handler received the right data
    expect(
      handler.lastCall.args[1].totalSizeInBytes,
      'sub handler called with bad argument "messages.totalSizeInBytes"'
    ).to.equal(messageBytesAll);
    expect(
      handler.lastCall.args[1].messages.length,
      'sub handler called with bad argument "messages.messages"'
    ).to.equal(messageCountAll);
    // Verify the instance class now has zero messages and zero bytes! (since a successful Buffer send should
    // perform a reset!
    expect(
      messageBatchingHandler.getMessageCount(),
      'Message count mismatch.'
    ).to.equal(0);
    expect(
      messageBatchingHandler.getBufferSize(),
      'Buffer size mismatch.'
    ).to.equal(0);
    // Close AMOP Cacoon
    amqpCacoon.close();
    // Exit the test
    return;
  });
});

// A dummy message. Changing this should not be necessary! It's content is not hugely important
// since we're not really sending anything, but it does need to have the valid structure!
// charLength will be used to create messages of varying lengths for testing.
function createDummyMessageOfLength(charLength: number): ConsumeMessage {
  let aString: string = '';
  for (let i = 0; i < charLength; i++) {
    aString += 'a';
  }
  return {
    content: Buffer.from(aString),
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: '',
      routingKey: '',
      consumerTag: '',
    },
    properties: {
      contentType: null,
      contentEncoding: null,
      headers: {},
      deliveryMode: null,
      priority: null,
      correlationId: null,
      replyTo: null,
      expiration: null,
      messageId: null,
      timestamp: null,
      type: null,
      userId: null,
      appId: null,
      clusterId: null,
    },
  };
}
