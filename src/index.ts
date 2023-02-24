import amqp, {
  ChannelWrapper,
  AmqpConnectionManager,
  AmqpConnectionManagerOptions,
} from 'amqp-connection-manager';
import {
  ConsumeMessage,
  Channel,
  ConfirmChannel,
  Options,
  Connection,
} from 'amqplib';
import { ILogger } from './types';
import MessageBatchingManager from './helpers/message_batching_manager';

type ConnectCallback = (channel: ConfirmChannel) => Promise<any>;
type BrokerConnectCallback = (connection: Connection, url: string) => void;
type BrokerDisconnectCallback = (err: Error) => void;

export {
  ConsumeMessage,
  ChannelWrapper,
  Channel,
  ConfirmChannel,
  ConnectCallback,
  BrokerConnectCallback,
  BrokerDisconnectCallback,
  AmqpConnectionManagerOptions,
};

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
  ackAll: (allUpTo?: boolean) => void;
  nackAll: (allUpTo?: boolean, requeue?: boolean) => void;
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
  vhost?: string;
  connectionString?: string;
  amqp_opts: AmqpConnectionManagerOptions;
  providers: {
    logger?: ILogger;
  };
  onChannelConnect?: ConnectCallback;
  onBrokerConnect?: BrokerConnectCallback;
  onBrokerDisconnect?: BrokerDisconnectCallback;
  // maxWaitForDrainMs?: number; // How long to wait for a drain event if RabbitMq fills up. Zero to wait forever. Defaults to 60000 ms (1 min)
}

/**
 * AmqpCacoon
 * This module is used to communicate using the RabbitMQ amqp protocol
 * Usage
 * 1. Instantiate and pass in the configuration using the IAmqpCacoonConfig interface
 * 2. Call publish() function to publish a message
 * 3. To consume messages call registerConsumer() passing in a handler function
 * 4. When consuming the callback registered in the previous step will be called when a message is received
 **/
class AmqpCacoon {
  private pubChannelWrapper: ChannelWrapper | null;
  private subChannelWrapper: ChannelWrapper | null;
  private connection?: AmqpConnectionManager;
  private fullHostName: string;
  private amqp_opts: AmqpConnectionManagerOptions;
  private logger?: ILogger;
  // private maxWaitForDrainMs: number;
  private onChannelConnect: ConnectCallback | null;
  private onBrokerConnect: Function | null;
  private onBrokerDisconnect: Function | null;

  /**
   * constructor
   *
   * Usage
   * This function just sets some class level variables
   *
   * @param config - Contains the amqp connection config and the Logger provder
   **/
  constructor(config: IAmqpCacoonConfig) {
    this.pubChannelWrapper = null;
    this.subChannelWrapper = null;
    this.fullHostName =
      config.connectionString || AmqpCacoon.getFullHostName(config);
    this.amqp_opts = config.amqp_opts;
    this.logger = config.providers.logger;
    // this.maxWaitForDrainMs = config.maxWaitForDrainMs || 60000; // Default to 1 min
    this.onChannelConnect = config.onChannelConnect || null;
    this.onBrokerConnect = config.onBrokerConnect || null;
    this.onBrokerDisconnect = config.onBrokerDisconnect || null;
  }

  /**
   * getFullHostName
   * Just generates the full connection name for amqp based on the passed in config
   * @param config - Contains the amqp connection config
   **/
  private static getFullHostName(config: IAmqpCacoonConfig) {
    var fullHostNameString =
      config.protocol +
      '://' +
      config.username +
      ':' +
      config.password +
      '@' +
      config.host +
      (config.port ? `:${config.port}` : '') +
      (config.vhost ? `/${config.vhost}` : '');

    return fullHostNameString;
  }

  private injectConnectionEvents(connection: AmqpConnectionManager) {
    // Subscribe to onConnect / onDisconnection functions for debugging
    connection.on('connect', this.handleBrokerConnect.bind(this));
    connection.on('disconnect', this.handleBrokerDisconnect.bind(this));
  }

  /**
   * getPublishChannel
   * This connects to amqp and creates a channel or gets the current channel
   * @return ChannelWrapper
   **/
  async getPublishChannel() {
    try {
      // Return the pubChannel if we are already connected
      if (this.pubChannelWrapper) {
        return this.pubChannelWrapper;
      }
      // Connect if needed
      this.connection =
        this.connection || amqp.connect([this.fullHostName], this.amqp_opts);

      if (this.connection) {
        this.injectConnectionEvents(this.connection);
      }

      // Open a channel (get reference to ChannelWrapper)
      // Add a setup function that will be called on each connection retry
      // This function is specified in the config
      this.pubChannelWrapper = this.connection.createChannel({
        setup: (channel: ConfirmChannel) => {
          if (this.onChannelConnect) {
            return this.onChannelConnect(channel);
          } else {
            return Promise.resolve();
          }
        },
      });
    } catch (e) {
      if (this.logger) this.logger.error('AMQPCacoon.connect: Error: ', e);
      throw e;
    }
    // Return the channel
    return this.pubChannelWrapper;
  }

  /**
   * getConsumerChannel
   * This connects to amqp and creates a channel or gets the current channel
   * @return ChannelWrapper
   **/
  async getConsumerChannel() {
    try {
      // Return the subChannel if we are already connected
      if (this.subChannelWrapper) return this.subChannelWrapper;
      // Connect if needed
      this.connection =
        this.connection || amqp.connect([this.fullHostName], this.amqp_opts);

      if (this.connection) {
        this.injectConnectionEvents(this.connection);
      }

      // Open a channel (get reference to ChannelWrapper)
      // Add a setup function that will be called on each connection retry
      // This function is specified in the config
      this.subChannelWrapper = this.connection.createChannel({
        setup: (channel: ConfirmChannel) => {
          // `channel` here is a regular amqplib `ConfirmChannel`.
          // Note that `this` here is the channelWrapper instance.
          if (this.onChannelConnect) {
            return this.onChannelConnect(channel);
          } else {
            return Promise.resolve();
          }
        },
      });
    } catch (e) {
      if (this.logger)
        this.logger.error('AMQPCacoon.getConsumerChannel: Error: ', e);
      throw e;
    }
    // Return the channel
    return this.subChannelWrapper;
  }

  /**
   * registerConsumerPrivate
   * registerConsumer and registerConsumerBatch use this function to register consumers
   *
   * @param queue - Name of the queue
   * @param consumerHandler: (channel: ChannelWrapper, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  private async registerConsumerPrivate(
    queue: string,
    consumerHandler: (
      channel: ChannelWrapper,
      msg: ConsumeMessage | null
    ) => Promise<void>,
    options?: ConsumerOptions
  ) {
    try {
      // Get consumer channel
      const channelWrapper = await this.getConsumerChannel();

      channelWrapper.addSetup((channel: Channel) => {
        // Register a consume on the current channel
        return channel.consume(
          queue,
          consumerHandler.bind(this, channelWrapper),
          options
        );
      });
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
   * @param handler: (channel: ChannelWrapper, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  async registerConsumer(
    queue: string,
    handler: (channel: ChannelWrapper, msg: ConsumeMessage) => Promise<void>,
    options?: ConsumerOptions
  ) {
    return this.registerConsumerPrivate(
      queue,
      async (channel: ChannelWrapper, msg: ConsumeMessage | null) => {
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
   * @param handler: (channel: ChannelWrapper, msg: object) => Promise<any> - A handler that receives the message
   * @param options : ConsumerOptions - Used to pass in consumer options
   * @return Promise<void>
   **/
  async registerConsumerBatch(
    queue: string,
    handler: (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => Promise<void>,
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
      async (channel: ChannelWrapper, msg: ConsumeMessage | null) => {
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
      // Actually returns a wrapper
      const channel = await this.getPublishChannel(); // Sets up the publisher channel

      // There's currently a reported bug in node-amqp-connection-manager saying the lib does
      // not handle drain events properly... requires research.
      // See https://github.com/valtech-sd/amqp-cacoon/issues/20
      await channel.publish(exchange, routingKey, msgBuffer, options);
      return;
    } catch (e) {
      if (this.logger) this.logger.error('AMQPCacoon.publish: Error: ', e);
      throw e;
    }
  }

  async close() {
    try {
      await this.closePublishChannel();
      await this.closeConsumerChannel();
      if (this.connection) {
        return this.connection.close();
      }
    } catch (error) {
      // Some unsent messages
    }
  }

  /**
   * closeConsumerChannel
   * Close consume channel
   * @return Promise<void>
   **/
  async closeConsumerChannel() {
    if (!this.subChannelWrapper) return;
    await this.subChannelWrapper.close();
    this.subChannelWrapper = null;
    return;
  }

  /**
   * closePublishChannel
   * Close publish channel
   * @return Promise<void>
   **/
  async closePublishChannel() {
    if (!this.pubChannelWrapper) return;
    await this.pubChannelWrapper.close();
    this.pubChannelWrapper = null;
    return;
  }

  /**
   * handleBrokerConnect
   * Fires onBrokerConnect callback function whenever amqp connection is made
   *
   * @return void
   **/
  private handleBrokerConnect(connection: Connection, url: string) {
    if (this.onBrokerConnect) {
      this.onBrokerConnect(connection, url);
    }
  }

  /**
   * handleBrokerDisconnect
   * Fires onBrokerDisconnect callback function whenever amqp connection is lost
   *
   * @return void
   **/
  private handleBrokerDisconnect(err: Error) {
    if (this.onBrokerDisconnect) {
      this.onBrokerDisconnect(err);
    }
  }
}

export default AmqpCacoon;
