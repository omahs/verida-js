'use strict'
const assert = require('assert')

import { Client } from '../src/index'
import { AutoAccount } from '@verida/account-node'
import { StorageLink } from '@verida/storage-link'
import { DIDDocument } from '@verida/did-document'
import CONFIG from './config'

const TEST_DB_NAME = 'TestDb_1'

/**
 * 
 */
describe('Storage context tests', () => {
    let didClient, context

    const client = new Client({
        didServerUrl: CONFIG.DID_SERVER_URL,
        environment: CONFIG.ENVIRONMENT
    })

    describe('Initialize user storage contexts', function() {
        this.timeout(100000)

        it(`can open a user storage context when authenticated`, async function() {
            const account = new AutoAccount(CONFIG.DEFAULT_ENDPOINTS, {
                privateKey: CONFIG.VDA_PRIVATE_KEY,
                didServerUrl: CONFIG.DID_SERVER_URL,
                environment: CONFIG.ENVIRONMENT
            })
            await client.connect(account)
            didClient = await account.getDidClient()
            const did = await account.did()

            await StorageLink.unlink(didClient, CONFIG.CONTEXT_NAME)

            context = await client.openContext(CONFIG.CONTEXT_NAME, true)
            assert.ok(context, 'Account context opened')

            const fetchedStorageConfig = await StorageLink.getLink(didClient, did, CONFIG.CONTEXT_NAME)
            const contextConfig = await context.getContextConfig()

            contextConfig.id = DIDDocument.generateContextHash(did, CONFIG.CONTEXT_NAME)
            assert.deepEqual(fetchedStorageConfig, contextConfig, 'Storage context config matches')
        })

        it('can open a database with owner/owner permissions', async function() {
            const database = await context.openDatabase(TEST_DB_NAME)

            const result = await database.save({'hello': 'world'})
            const data = await database.getMany({
                _id: result.id
            })

            assert.ok(data, 'Data returned')
            assert.ok(data.length && data.length > 0, 'Array returned with at least one row')
            assert.ok(data[0].hello == 'world', 'First result has expected value')
        })
        
    })
})