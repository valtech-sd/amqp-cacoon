import amqp from 'amqplib';
import { ConsumeMessage, Connection, Channel, Options } from 'amqplib';
import { Logger } from 'log4js';
import MessageBatchingManager from './helpers/message_batching_manager';

export { ConsumeMessage, Channel };

const DEFAULT_MAX_FILES_SIZE_BYTES = 1024 * 1024 * 2; // 2 MB
const DEFAULT_MAX_BUFFER_TIME_MS = 60 * 1000; // 60 seconds

// Used as return value in handler for registerConsumerBatch function
export interface ConsumeBatchMessages {
  batchingOptions: {
    maxSizeBytes?: number;
    maxTimeMs?: number;
  };
  totalSizeInBytes: number;
  messages: Array<ConsumeMessage>;
  ackAll: (allUpTo?: boolean) => {};
  nackAll: (allUpTo?: boolean, requeue?: boolean) => {};
}

// Used for registerConsumer function
export interface ConsumerOptions extends Options.Consume {}

// Used for registerConsumerBatch function
export interface ConsumerBatchOptions extends Options.Consume {
  batching?: {
    maxSizeBytes?: number;
    maxTimeMs?: number;
  };
}

export interface IAmqpCacoonConfig {
  protocol?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  connectionString?: string;
  amqp_opts: object;
  providers: {
    logger?: Logger;
  };
  maxWaitForDrainMs?: number; // How long to wait for a drain event if RabbitMq fills up. Zero to wait forever. Defaults to 60000 ms (1 min)
}
/**
 * AmqpCacoon
 * This module is used to communicate using the RabbitMQ amqp protocol
 * Usage
 * 1. Instantiate and pass in the configuration using the IAmqpCacoonConfig interface
 * 2. Call publish() function to publish a message
 * 3. To consume messages call registerConsumer() passing in a handler funciton
 * 4. When consuming the callback registered in the previous step will be called when a message is received
 **/
class AmqpCacoon {
  private pubChannel: Channel | null;
  private subChannel: Channel | null;
  private connection?: Connection;
  private fullHostName: string;
  private amqp_opts: object;
  private logger?: Logger;
  private maxWaitForDrainMs: number;

  /**
   * constructor
   *
   * Usage
   * This function just sets some class level variables
   *
   * @param config - Contains the amqp connection config and the Logger provder
   **/
  constructor(config: IAmqpCacoonConfig) {
    this.pubChannel = null;
    this.subChannel = null;
    this.fullHostName = config.connectionString || this.getFullHostName(config);
    this.amqp_opts = config.amqp_opts;
    this.logger = config.providers.logger;
    this.maxWaitForDrainMs = config.maxWaitForDrainMs || 60000; // Default to 1 min
  }

  /**
   * getFullHostName
   * Just generates the full connection name for amqp based on the passed in config
   * @param config - Contains the amqp connection config
   **/
  private getFullHostName(config: IAmqpCacoonConfig) {
    var fullHostNameString =
      config.protocol +
      '://' +
      config.username +
      ':' +
      config.password +
      '@' +
      config.host;

    if (config.port) {
      fullHostNameString = fullHostNameString + ':' + config.port;
    }

    return fullHostNameString;
  }

  /**
   * getPublishChannel
   * This connects to amqp and creates a channel or gets the current channel
   * @return channel
   **/
  async getPublishChannel() {
    try {
      // Return the pubChannel if we are already connected
      if (this.pubChannel) return this.pubChannel;
      // Connect if needed
      this.connection =
        this.connection ||
        (await amqp.connect(this.fullHostName, this.amqp_opts));
      // Open a channel
      this.pubChannel = await this.connection.createChannel();
    } catch (e) {
      if (this.logger) this.logger.error('AMQPCacoon.connect: Error: ', e);
      throw e;
    }
    // Return the channel
    return this.pubChannel;
  }

  /**
   * getConsumerChannel
   * This connects to amqp and creates a channel or gets the current channel
   * @return channel
   **/
  async getConsumerChannel() {
    try {
      // Return the subChannel if we are already connected
      if (this.subChannel) return this.subChannel;
      // Connect if needed
      this.connection =
        this.connection ||
        (await amqp.connect(this.fullHostName, this.amqp_opts));
      // Open a channel
      this.subChannel = await this.connection.createChannel();
    } catch (e) {
      if (this.logger)
        this.logger.error('AMQPCacoon.getConsumerChannel: Error: ', e);
      throw e;
    }
    // Return the channel
    return this.subChannel;
  }

  /**
   * registerConsumerPrivate
   * registerConsumer and registerConsumerBatch use this function to register consumers
   *
   * @param queue - Name of the queue
   * @param handler: (channel: Channel, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  private async registerConsumerPrivate(
    queue: string,
    consumerHandler: (
      channel: Channel,
      msg: ConsumeMessage | null
    ) => Promise<void>,
    options?: ConsumerOptions
  ) {
    try {
      // Get consumer channel
      const channel = await this.getConsumerChannel();

      // Register a consume on the current channel
      await channel.consume(
        queue,
        consumerHandler.bind(this, channel),
        options
      );
    } catch (e) {
      if (this.logger)
        this.logger.error('AMQPCacoon.registerConsumerPrivate: Error: ', e);
      throw e;
    }
  }

  /**
   * registerConsumer
   * After registering a handler on a queue that handler will
   * get called for messages received on the specified queue
   *
   * @param queue - Name of the queue
   * @param handler: (channel: Channel, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  async registerConsumer(
    queue: string,
    handler: (channel: Channel, msg: ConsumeMessage) => Promise<void>,
    options?: ConsumerOptions
  ) {
    return this.registerConsumerPrivate(
      queue,
      async (channel: Channel, msg: ConsumeMessage | null) => {
        if (!msg) return; // We know this will always be true but typescript requires this
        await handler(channel, msg);
      },
      options
    );
  }

  /**
   * registerConsumerBatch
   * This is very similar to registerConsumer except this enables message batching.
   * The following options are configurable
   * 1. batching.maxTimeMs - Max time in milliseconds before we return the batch
   * 2. batching.maxSizeBytes - Max size in bytes before we return
   *
   * @param queue - Name of the queue
   * @param handler: (channel: Channel, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  async registerConsumerBatch(
    queue: string,
    handler: (channel: Channel, msg: ConsumeBatchMessages) => Promise<void>,
    options?: ConsumerBatchOptions
  ) {
    // Set some default options
    if (!options?.batching) {
      options = Object.assign(
        {},
        {
          batching: {
            maxTimeMs: DEFAULT_MAX_BUFFER_TIME_MS,
            maxSizeBytes: DEFAULT_MAX_FILES_SIZE_BYTES,
          },
        },
        options
      );
    }

    // Initialize Message batching manager
    let messageBatchingHandler: MessageBatchingManager;
    messageBatchingHandler = new MessageBatchingManager({
      providers: { logger: this.logger },
      maxSizeBytes: options?.batching?.maxSizeBytes,
      maxTimeMs: options?.batching?.maxTimeMs,
      skipNackOnFail: options?.noAck,
    });

    // Register consumer
    return this.registerConsumerPrivate(
      queue,
      async (channel: Channel, msg: ConsumeMessage | null) => {
        if (!msg) return; // We know this will always be true but typescript requires this

        // Handle message batching
        messageBatchingHandler.handleMessageBuffering(channel, msg, handler);
      },
      options
    );
  }

  /**
   * publish
   * publish to an exchange
   *
   * @param exchange - name of the echange
   * @param routingKey - queue or queue routingKey
   * @param msgBuffer - Message buffer
   * @param options - Options for publishing
   * @return Promise<void> - Promise resolves when done sending
   **/
  async publish(
    exchange: any,
    routingKey: any,
    msgBuffer: any,
    options?: Options.Publish
  ) {
    try {
      const channel = await this.getPublishChannel(); // Sets up the publisher channel

      // We add a promise so that we can control flow
      // Perform the channel operation and hold the result which will be true/false per AMQP Lib docs
      const channelReady = channel.publish(
        exchange,
        routingKey,
        msgBuffer,
        options
      );
      if (this.logger) {
        this.logger.trace(`AMQPCacoon.publish result: ${channelReady}`);
      }
      // Check the result. channelReady == true means we can keep sending, so we resolve this promise
      if (channelReady) {
        return;
      } else {
        // Otherwise, channelReady == false so we have to wait for the pubChannel's on 'drain'
        if (this.logger) {
          this.logger.info(
            'AMQPCacoon.publish buffer full. Waiting for "drain"...'
          );
        }

        // Set a handler for the drain event
        await new Promise((resolve, reject) => {
          if (!this.pubChannel) {
            // This shouldn't ever happen
            throw new Error(
              `AMQPCacoon.public: Publisher channel has not been set up`
            );
          }
          // Set a timeout in case Drain is slow, at least we log it
          let timeoutHandler: any =
            this.maxWaitForDrainMs !== 0
              ? setTimeout(() => {
                  if (this.logger) {
                    this.logger.info(
                      `AMQPCacoon.publish: After a full buffer, slow buffer: \nmsg: ${msgBuffer.toString(
                        'utf8'
                      )}`
                    );
                  }
                  if (timeoutHandler) {
                    timeoutHandler = null;
                    reject(
                      new Error(
                        `AMQPCacoon.public: Timeout after ${this.maxWaitForDrainMs}ms`
                      )
                    );
                  }
                }, this.maxWaitForDrainMs)
              : true;

          channel.once('drain', () => {
            if (this.logger) {
              this.logger.trace('AMQPCacoon.publish: "drain" received.');
            }
            // resolve since we now can proceed
            if (timeoutHandler) {
              if (this.maxWaitForDrainMs !== 0) {
                clearTimeout(timeoutHandler);
                timeoutHandler = null;
              }
              resolve();
            }
          });
        });
      }
    } catch (e) {
      if (this.logger) this.logger.error('AMQPCacoon.publish: Error: ', e);
      throw e;
    }
  }

  async close() {
    await this.closePublishChannel();
    await this.closeConsumerChannel();
    if (this.connection) {
      return this.connection.close();
    }
  }

  /**
   * closeConsumerChannel
   * Close consume channel
   * @return Promise<void>
   **/
  async closeConsumerChannel() {
    if (!this.subChannel) return;
    await this.subChannel.close();
    this.subChannel = null;
    return;
  }

  /**
   * closePublishChannel
   * Close publish channel
   * @return Promise<void>
   **/
  async closePublishChannel() {
    if (!this.pubChannel) return;
    await this.pubChannel.close();
    this.pubChannel = null;
    return;
  }
}
export default AmqpCacoon;
