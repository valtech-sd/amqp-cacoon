import {expect} from 'chai';
import _ from 'lodash';
import 'mocha';
import simple from 'simple-mock';
import AmqpCacoon, {
    IAmqpCacoonConfig,
    ChannelWrapper,
    ConsumeMessage,
    Channel,
    ConsumeBatchMessages,
    ConsumerBatchOptions,
} from '../../src';

let defaultMessageBusConfig = {
  // Protocol should be "amqp" or "amqps"
  protocol: 'amqp',
  // Username + Password on the RabbitMQ host
  username: 'valtech',
  password: 'iscool',
  // Host
  host: 'localhost',
  // Port
  port: 5672,
};
const config: any = {
    messageBus: {
        // Queue setup
        testQueue: 'test-queue',
    },
};

if (process.env.RABBITMQ_CONNECTION_STRING) {
    config.messageBus.connectionString = process.env.RABBITMQ_CONNECTION_STRING;
} else {
    _.extend(config.messageBus, defaultMessageBusConfig);
}

import log4js from 'log4js';

let logger = log4js.getLogger();
logger = log4js.getLogger('synchronous');
logger.level = 'trace';

describe('Amqp Cacoon', () => {
    let amqpCacoonConfig: IAmqpCacoonConfig = {
        protocol: config.messageBus.protocol,
        username: config.messageBus.username,
        password: config.messageBus.password,
        host: config.messageBus.host,
        port: config.messageBus.port,
        connectionString: config.messageBus.connectionString,
        amqp_opts: {},
        providers: {
            logger: logger,
        },
        onConnect: async function (channel: Channel) {
            if (channel) {
                await channel.assertQueue(config.messageBus.testQueue);
                await channel.purgeQueue(config.messageBus.testQueue);
            }
        },
        maxWaitForDrainMs: 50,
    };

    afterEach(() => {
        simple.restore();
    });
    // Just make sure it initializes
    it('Constructor: Initializes', () => {
        new AmqpCacoon(amqpCacoonConfig);
    });

    it('getConsumerChannel() - channel is returned', async () => {
        let amqpCacoon: any;
        try {
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
            let channel: ChannelWrapper | null = await amqpCacoon.getConsumerChannel();
            expect(channel, 'Is undefined').to.not.be.undefined;
            expect(channel, 'Is null').to.not.be.null;

            if (amqpCacoon) amqpCacoon.close();
        } catch (e) {
            if (amqpCacoon) amqpCacoon.close();
            throw e;
        }
    });

    it('getPublishChannel() - channel is returned', async () => {
        let amqpCacoon: any;
        try {
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
            let channel: ChannelWrapper | null = await amqpCacoon.getPublishChannel();
            expect(channel, 'Is undefined').to.not.be.undefined;
            expect(channel, 'Is null').to.not.be.null;

            if (amqpCacoon) amqpCacoon.close();
        } catch (e) {
            if (amqpCacoon) amqpCacoon.close();
            throw e;
        }
    });

    it('adds setup function', async () => {
        let amqpCacoon: AmqpCacoon | null = null;

        try {
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
            let channel: ChannelWrapper | null = await amqpCacoon.getPublishChannel();

            expect(channel, 'Is undefined').to.not.be.undefined;

            await amqpCacoon.publish(
                '',
                config.messageBus.testQueue,
                Buffer.from('TestString')
            );

            //
            if (amqpCacoon) amqpCacoon.close();
        } catch (e) {
            if (amqpCacoon) amqpCacoon.close();
            throw e;
        }
    });

    it('publish/consume - Published message is received correctly', async () => {
        let amqpCacoon: AmqpCacoon | null = null;

        try {
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);

            await new Promise(async (resolve, reject) => {

                    if (!amqpCacoon) {
                        return reject(
                            new Error('Some how amqpCacoon is null. This should not happen')
                        );
                    }

                    let resolved = false;
                    await amqpCacoon.registerConsumer(
                        config.messageBus.testQueue,
                        async (channel: ChannelWrapper, msg: ConsumeMessage) => {
                            try {
                                channel.ack(msg);
                                expect(msg.content.toString(), 'Wrong message received').to.equal(
                                    'TestString'
                                );
                                if (!resolved) {
                                    resolved = true;
                                    resolve();
                                }
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );

                    // Can we publish before registering consumer?
                    await amqpCacoon.publish(
                        '',
                        config.messageBus.testQueue,
                        Buffer.from('TestString')
                    );

                    setTimeout(() => {
                        if (!resolved) {
                            reject(new Error('Message rx: Timed out'));
                            resolved = true;
                        }
                    }, 200);
                }
            );

            // Add short delay before closing connection
            // For some reason, closing the channel immediately causes issues
            const delay = (ms: any) => new Promise(resolve => setTimeout(resolve, ms));

            await delay(1000).then(async () => {
                if (amqpCacoon) {
                    await amqpCacoon.close();
                }
            });

        } catch (e) {
            if (amqpCacoon) await amqpCacoon.close();
            throw e;
        }
    });

    // Skipping this test for now, until we confirm / deny that we will try to listen to drain event
    it.skip('publish - Drain timeout path', async () => {
        let amqpCacoon: AmqpCacoon | null = null;
        try {
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);

            let channelStubs = {
                publish: simple.stub().returnWith(false),
                once: simple.stub(),
            };
            let override: any = amqpCacoon;
            override.pubChannel = channelStubs;

            // Test drain with timeout
            try {
                await amqpCacoon.publish(
                    '',
                    config.messageBus.testQueue,
                    Buffer.from('TestString')
                );
                throw new Error(
                    'Failed! amqpCacoon.publish should have been rejected!'
                );
            } catch (e) {
                console.log(e);
                expect(e.message).to.include('Timeout');
            }

            // Test drain without timeout
            channelStubs.once.callbackWith(null);
            await amqpCacoon.publish(
                '',
                config.messageBus.testQueue,
                Buffer.from('TestString')
            );

            expect(channelStubs.publish.called, 'channel.publish was not called').to
                .be.true;
            expect(channelStubs.once.called, 'channel.once was not called').to.be
                .true;
        } catch (e) {
            throw e;
        }
    });

    it('registerConsumerBatch - Batches on time limit', async () => {
        try {
            let messageStrings = ['Test1', 'Test2'];
            await testBatchConsume(messageStrings, messageStrings, {
                batching: {maxTimeMs: 200},
            });
        } catch (e) {
            throw e;
        }
    });

    it('registerConsumerBatch - Batches on message size', async () => {
        try {
            // Doesn't get messages after going over size
            await testBatchConsume(['Test1', 'Test2', 'Test3'], ['Test1', 'Test2'], {
                batching: {maxTimeMs: 0, maxSizeBytes: 6},
            });

            // Works on large messages
            let largeMessage = '';
            for (let i = 0; i < 1024 * 1024; i++) {
                largeMessage += 'a';
            }
            await testBatchConsume(
                [largeMessage, largeMessage, largeMessage],
                [largeMessage, largeMessage],
                {
                    batching: {maxTimeMs: 1000, maxSizeBytes: 1024 * 1024 * 2},
                }
            );
        } catch (e) {
            throw e;
        }
    });

    /**
     * testBatchConsume
     * This is used by other tests to test the registerConsumerBatch function
     *
     * Does this by
     * 1. Setup amqp
     * 2. Purge queue to make sure other tests are not messing us up
     * 3. Publish all txMessageStrings to bus
     * 4. Register callback with registerConsumerBatch
     * 5. Within callback ack all if messages come through.
     * 6. Test message length using rxMessageStrings.length
     * 7. Test message buffer size
     * 8. Compare rxMessageStrings values to incomming messages
     * 9. Reject if we timeout
     */
    async function testBatchConsume(
        txMessageStrings: Array<string>,
        rxMessageStrings: Array<string>,
        consumerOptions: ConsumerBatchOptions
    ) {
        let amqpCacoon: AmqpCacoon | null = null;
        try {
            // 1. Setup amqp
            amqpCacoon = new AmqpCacoon(amqpCacoonConfig);
            let channel: ChannelWrapper | null = await amqpCacoon.getPublishChannel();
            // if (channel) await channel.assertQueue(config.messageBus.testQueue);
            // 2. Purge queue to make sure other tests are not messing us up
            // await channel.purgeQueue(config.messageBus.testQueue);

            await new Promise(async (resolve, reject) => {
                if (!amqpCacoon) {
                    return reject(
                        new Error('Some how amqpCacoon is null. This should not happen')
                    );
                }
                // 3. Publish all txMessageStrings to bus
                for (let msg of txMessageStrings) {
                    await amqpCacoon.publish(
                        '',
                        config.messageBus.testQueue,
                        Buffer.from(msg)
                    );
                }

                let resolved = false;
                // 4. Register callback with registerConsumerBatch
                amqpCacoon.registerConsumerBatch(
                    config.messageBus.testQueue,
                    async (channel: ChannelWrapper, batch: ConsumeBatchMessages) => {
                        try {
                            // 5. Within callback ack all if messages come through.
                            batch.ackAll();
                            // 6. Test message length using rxMessageStrings.length
                            expect(batch.messages).to.have.length;
                            expect(batch.messages.length).to.equal(rxMessageStrings.length);
                            // 7. Test message buffer size
                            expect(batch.totalSizeInBytes).to.equal(
                                rxMessageStrings // Sum length of all string in array
                                    .map((m) => m.length)
                                    .reduce((note, value) => note + value, 0)
                            );

                            // 8. Compare rxMessageStrings values to incomming messages
                            for (let msg of batch.messages) {
                                expect(
                                    rxMessageStrings,
                                    'Message String did not match'
                                ).to.includes(msg.content.toString());
                            }

                            if (!resolved) {
                                resolve();
                                resolved = true;
                            }
                        } catch (e) {
                            if (!resolved) {
                                reject(e);
                            }
                        }
                    },
                    consumerOptions
                );
                // Set timer incase we timeout
                setTimeout(() => {
                    if (!resolved) {
                        // 9. Reject if we timeout
                        reject(new Error('Message rx: Timed out'));
                        resolved = true;
                    }
                }, (consumerOptions?.batching?.maxTimeMs || 0) + 100);
            });
            if (amqpCacoon) amqpCacoon.close();
        } catch (e) {
            if (amqpCacoon) amqpCacoon.close();
            throw e;
        }
    }
});
