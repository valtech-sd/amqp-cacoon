import amqp from 'amqplib';
import { ConsumeMessage, Channel } from 'amqplib';
import { Logger } from 'log4js';
export { ConsumeMessage, Channel };
export interface IAmqpProviderConfig {
    protocol: string;
    username: string;
    password: string;
    host: string;
    port?: number;
    amqp_opts: object;
    providers: {
        logger: Logger;
    };
}
/**
 * AmqpProvider
 * This provider is used to communicate using the RabbitMQ amqp protocol
 * Usage
 * 1. Instantiate and pass in the configuration using the IAmqpProviderConfig interface
 * 2. To publish call connect() before publishing
 * 3. Call publish() function to publish a message
 * 4. To consume messages call registerConsumer() passing in a handler funciton
 * 5. When consuming the callback registered in the previous step will be called when a message is received
 **/
declare class AmqpProvider {
    private pubChannel;
    private subChannel;
    private connection?;
    private fullHostName;
    private amqp_opts;
    private logger;
    /**
     * constructor
     *
     * Usage
     * This function just sets some class level variables
     *
     * @param config - Contains the amqp connection config and the Logger provder
     **/
    constructor(config: IAmqpProviderConfig);
    /**
     * getFullHostName
     * Just generates the full connection name for amqp based on the passed in config
     * @param config - Contains the amqp connection config
     **/
    private getFullHostName;
    /**
     * getChannel
     * This connects to amqp and creates a channel or gets the current channel
     * @return channel
     **/
    getChannel(): Promise<amqp.Channel | null>;
    /**
     * registerConsumer
     * After registering a handler on a queue that handler will
     * get called for messages received on the specified queueu
     *
     * @param queue - Name of the queue
     * @param handler: (msg: object) => Promise<any> - A handler that receives the message
     * @return channel
     **/
    registerConsumer(queue: string, handler: (channel: Channel, msg: ConsumeMessage) => Promise<void>): Promise<void>;
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
    publish(exchange: any, routingKey: any, msgBuffer: any, options?: any): Promise<void>;
    close(): Promise<void>;
}
export default AmqpProvider;
