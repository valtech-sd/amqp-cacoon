import { ChannelWrapper, ConsumeMessage, ConsumeBatchMessages } from '../index';
import { Logger } from 'log4js';

export interface IMessageBatchingManagerConfig {
  providers: {
    logger?: Logger;
  };
  maxSizeBytes?: number;
  maxTimeMs?: number;
  skipNackOnFail?: boolean;
}

export default class MessageBatchingManager {
  private unackedMessageList: Array<ConsumeMessage> = [];
  private bufferSize: number = 1;
  private timerHandle?: NodeJS.Timeout;
  private amqpChannel?: ChannelWrapper;
  private logger?: Logger;
  constructor(private config: IMessageBatchingManagerConfig) {
    this.logger = config.providers.logger;

    this.resetMessages();
  }

  /**
   * resetMessages
   * Reset message list
   * Do this by...
   * 1. Reset unackedMessageList
   * 2. Reset buffer size
   *
   * @param originalMessage: ConsumeMessage
   * @param json: object
   */
  resetMessages() {
    // 1. Reset unackedMessageList
    this.unackedMessageList = [];
    // 2. Reset buffer size (= 1 to account for end character. We account for comma and start character when adding to message)
    this.bufferSize = 0;
  }

  /**
   * addMessage
   * Add message to list and buffer
   * Do this by...
   * 1. Push message to list
   * 2. Increment buffer size
   *
   * @param originalMessage: ConsumeMessage
   */
  addMessage(msg: ConsumeMessage) {
    // 1. Push message to list
    this.unackedMessageList.push(msg);
    // 2. Increment buffer size
    this.bufferSize += msg.content.byteLength;
  }

  /**
   * finalizeMessages
   * Finalize message list
   * Do this by...
   * 1. Get current messages list
   * 2. Reset message list
   */
  finalizeMessages(): {
    bufferSize: number;
    unackedMessageList: Array<ConsumeMessage>;
  } {
    // 1. Get current messages list
    let unackedMessageList = this.unackedMessageList;
    let bufferSize = this.bufferSize;

    // 2. Reset message list
    this.resetMessages();

    return { bufferSize, unackedMessageList };
  }

  /**
   * ackMessageList
   * Ack all messages in list
   * Do this by...
   * 1. Ack the last message using allUpTo argumetn to specify that all messages up to the last should be nacked
   *
   * @param channel: Channel - Channel
   * @param messageList: Array<ConsumeMessage> - Messages to be acked
   */
  ackMessageList(channel: ChannelWrapper, messageList: Array<ConsumeMessage>) {
    if (this.logger) {
      this.logger.trace(`MessageBatchingManager.ackMessageList: Start`);
    }
    // 1. Ack the last message using allUpTo argumetn to specify that all messages up to the last should be nacked
    //channel.ack(messageList[messageList.length - 1], true);
    for (let msg of messageList) {
      channel.ack(msg);
    }
    if (this.logger) {
      this.logger.trace(`MessageBatchingManager.ackMessageList: End`);
    }
  }

  /**
   * nackMessageList
   * Nack all messages in list
   * Do this by...
   * 1. Nack the last message using the allUpTo argument to specify that all messages up to the last should be nacked
   *
   * @param channel: Channel - Channel
   * @param messageList: Array<ConsumeMessage> - Messages to be nacked
   */
  nackMessageList(
    channel: ChannelWrapper,
    messageList: Array<ConsumeMessage>,
    requeue?: boolean
  ) {
    if (this.logger) {
      this.logger.trace(`MessageBatchingManager.nackMessageList: Start`);
    }
    // 1. Nack the last message using the allUpTo argument to specify that all messages up to the last should be nacked
    //channel.nack(messageList[messageList.length - 1], true, requeue);
    for (let msg of messageList) {
      channel.nack(msg, requeue);
    }
    if (this.logger) {
      this.logger.trace(`MessageBatchingManager.nackMessageList: End`);
    }
  }

  /**
   * sendBufferedMessages
   * Send transformed buffered messages and ack/nack originals
   * Do this by...
   * 1. Finalize message buffer and fetch buffer and unackedMessageList
   * 2. Call handler function (Assume it nacks or acks)
   * 3. Ack unackedMessageList
   * 4. If error then nack unackedMessageList. Assume nack never occured if here
   *
   * @returns void
   */
  async sendBufferedMessages(
    channel: ChannelWrapper,
    handler: (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => Promise<void>
  ) {
    let unackedMessageList: Array<ConsumeMessage> = [];
    let bufferSize: number;
    try {
      // 1. Finalize message buffer and fetch buffer and unackedMessageList
      ({ bufferSize, unackedMessageList } = this.finalizeMessages());

      // 2. Send messages to handler
      let messages: ConsumeBatchMessages = {
        batchingOptions: {
          maxTimeMs: this.config.maxTimeMs,
          maxSizeBytes: this.config.maxSizeBytes,
        },
        totalSizeInBytes: bufferSize,
        messages: unackedMessageList,
        ackAll: () => this.ackMessageList(channel, unackedMessageList),
        nackAll: (requeue?: boolean) =>
          this.nackMessageList(channel, unackedMessageList, requeue),
      };
      await handler(channel, messages);

      // 3. Ack unackedMessageList
      // this.ackMessageList(channel, unackedMessageList);
    } catch (e) {
      // 4. If error then nack unackedMessageList
      if (!this.config.skipNackOnFail && unackedMessageList.length > 0) {
        this.nackMessageList(channel, unackedMessageList);
      }
    }
  }

  /**
   * handleMessageBuffering
   * This function handles buffering and sending of messages
   * The rules are as follows.
   * 1. If buffer size > MAX_FILES_SIZE_BYTES then send the message
   * 2. If time elapsed since first message in group > MAX_BUFFER_TIME_MS then send grouped messages
   *
   * Do this by...
   * 1. Set channel variable for this object. This way we don't have to do an async call elswhere.
   * 2. Add message to a buffer
   * 3. Check buffer byte length and clear timer and send message if files size > MAX_FILES_SIZE_BYTES
   * 4. Else Setup timer if it is not already setup to send buffered messages
   * 5. When timer expires, send message
   *
   * @param originalMessage: ConsumeMessage - Used for ack and nack of messages
   * @param transformedMessage: object - Sent in buffered message
   * @returns void
   */
  async handleMessageBuffering(
    channel: ChannelWrapper,
    msg: ConsumeMessage,
    handler: (
      channel: ChannelWrapper,
      msg: ConsumeBatchMessages
    ) => Promise<void>
  ) {
    // 1. Set channel variable for this object. This way we don't have to do an async call elswhere.
    this.amqpChannel = channel;
    // 2. Add message to a buffer
    this.addMessage(msg);
    if (
      this.config.maxSizeBytes &&
      this.bufferSize >= this.config.maxSizeBytes
    ) {
      // 3. Check buffer byte length and clear timer and send message if files size > MAX_FILES_SIZE_BYTES
      if (this.timerHandle) {
        // Clear timeout
        clearTimeout(this.timerHandle);
        this.timerHandle = undefined;
      }
      // send message
      await this.sendBufferedMessages(this.amqpChannel, handler);
    } else if (this.config.maxTimeMs) {
      // 4. Else Setup timer if it is not alread setup to send buffered messages
      if (!this.timerHandle) {
        this.timerHandle = setTimeout(() => {
          // 5. When timer expires, send message. We know amqpChannel cannot be null here
          this.sendBufferedMessages(this.amqpChannel!, handler);
          this.timerHandle = undefined;
        }, this.config.maxTimeMs);
      }
    }
  }
}
