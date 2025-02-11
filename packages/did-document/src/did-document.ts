import { Keyring } from '@verida/keyring'
import { DIDDocumentStruct, Endpoints, EndpointType } from './interfaces'
import EncryptionUtils from '@verida/encryption-utils'
import { ServiceEndpoint, VerificationMethod } from 'did-resolver'

export default class DIDDocument {

    private doc: DIDDocumentStruct
    protected errors: string[] = []

    /**
     * Force lower case DID as we can't guarantee the DID will always be provided with checksum
     * 
     * @param doc 
     */
    constructor(doc: DIDDocumentStruct | string, publicKeyHex?: string) {
        if (typeof(doc) == 'string') {
            // We are creating a new DID Document
            // Make sure we have a public key
            if (!publicKeyHex || publicKeyHex.length != 132) {
                throw new Error('Unable to create DID Document. Invalid or non-existent public key.')
            }

            const did = doc.toLowerCase()
            this.doc = {
                id: did,
                controller: did
            }

            // Add default signing key
            this.doc.assertionMethod = [this.doc.id]
            this.doc.verificationMethod = [{
                id: this.doc.id,
                type: "EcdsaSecp256k1VerificationKey2019",
                controller: this.doc.id,
                publicKeyHex: publicKeyHex
            }]
        } else {
            doc.id = doc.id.toLowerCase()
            this.doc = doc
        }
    }

    public get id() {
        return this.doc.id
    }

    public getErrors(): string[] {
        return this.errors
    }

    /**
     * Not used directly, used for testing
     * 
     * @param contextName 
     * @param keyring 
     * @param endpoints 
     */
    public async addContext(contextName: string, keyring: Keyring, endpoints: Endpoints) {
        // Remove this context if it already exists
        this.removeContext(contextName)

        // Build context hash in the correct format
        const contextHash = DIDDocument.generateContextHash(this.doc.id, contextName)

        // Add services
        this.addContextService(contextHash, EndpointType.DATABASE, endpoints.database.type, endpoints.database.endpointUri)
        this.addContextService(contextHash, EndpointType.MESSAGING, endpoints.messaging.type, endpoints.messaging.endpointUri)

        if (endpoints.storage) {
            this.addContextService(contextHash, EndpointType.STORAGE, endpoints.storage.type, endpoints.storage.endpointUri)
        }

        if (endpoints.notification) {
            this.addContextService(contextHash, EndpointType.NOTIFICATION, endpoints.notification.type, endpoints.notification.endpointUri)
        }

        // Add keys
        const keys = await keyring.getKeys()
        this.addContextSignKey(contextHash, keys.signPublicKeyHex)
        this.addContextAsymKey(contextHash, keys.asymPublicKeyHex)
    }

    public removeContext(contextName: string): boolean {
        const contextHash = DIDDocument.generateContextHash(this.doc.id, contextName)

        if (!this.doc.verificationMethod) {
            this.errors = ['No verification method specified']
            return false
        }

        const contextDid = `${this.doc.id}\\?context=${contextHash}`

        if (!this.doc.verificationMethod!.find((entry: VerificationMethod) => entry.id.match(contextDid))) {
            this.errors = ['Unable to locate verification method for this context']
            return false
        }

        // Remove signing key and asymmetric key
        this.doc.verificationMethod = this.doc.verificationMethod!.filter((entry: VerificationMethod) => {
            return !entry.id.match(contextDid)
        })
        this.doc.assertionMethod = this.doc.assertionMethod!.filter((entry: string | VerificationMethod) => {
            return entry !== `${this.doc.id}?context=${contextHash}#sign`
        })
        this.doc.keyAgreement = this.doc.keyAgreement!.filter((entry: string | VerificationMethod) => {
            return entry !== `${this.doc.id}?context=${contextHash}#asym`
        })
        
        // Remove services
        this.doc.service = this.doc.service!.filter((entry: ServiceEndpoint) => {
            return !entry.id.match(contextDid)
        })

        return true
    }

    public import(doc: DIDDocumentStruct) {
        doc.id = doc.id.toLowerCase()
        this.doc = doc
    }

    public export() {
        return this.doc
    }

    public addContextService(contextHash: string, endpointType: EndpointType, serviceType: string, endpointUri: string) {
        if (!this.doc.service) {
            this.doc.service = []
        }

        this.doc.service.push({
            id: `${this.doc.id}?context=${contextHash}#${endpointType}`,
            type: serviceType,
            serviceEndpoint: endpointUri
        })
    }

    public addContextSignKey(contextHash: string, publicKeyHex: string) {
        // Add verification method
        if (!this.doc.verificationMethod) {
            this.doc.verificationMethod = []
        }

        this.doc.verificationMethod.push({
            id: `${this.doc.id}?context=${contextHash}#sign`,
            type: "EcdsaSecp256k1VerificationKey2019",
            controller: this.doc.id,
            publicKeyHex: publicKeyHex
        })

        // Add assertion method
        if (!this.doc.assertionMethod) {
            this.doc.assertionMethod = []
        }

        this.doc.assertionMethod.push(`${this.doc.id}?context=${contextHash}#sign`)
    }

    public addContextAsymKey(contextHash: string, publicKeyHex: string) {
        // Add verification method
        if (!this.doc.verificationMethod) {
            this.doc.verificationMethod = []
        }

        this.doc.verificationMethod.push({
            id: `${this.doc.id}?context=${contextHash}#asym`,
            type: "Curve25519EncryptionPublicKey",
            controller: this.doc.id,
            publicKeyHex: publicKeyHex
        })

        // Add assertion method
        if (!this.doc.keyAgreement) {
            this.doc.keyAgreement = []
        }

        this.doc.keyAgreement.push(`${this.doc.id}?context=${contextHash}#asym`)
    }

    public signProof(privateKey: Uint8Array | string) {
        if (privateKey == 'string') {
            privateKey = new Uint8Array(Buffer.from(privateKey.substr(2),'hex'))
        }

        const proofData = this.getProofData()
        const signature = EncryptionUtils.signData(proofData, <Uint8Array> privateKey)

        this.doc.proof = {
            type: "EcdsaSecp256k1VerificationKey2019",
            verificationMethod: `${this.doc.id}`,
            proofPurpose: "assertionMethod",
            proofValue: signature
        }
    }

    public verifyProof() {
        if (!this.doc.proof) {
            return false
        }

        const signature = this.doc.proof.proofValue
        const proofData = this.getProofData()

        return this.verifySig(proofData, signature)
    }

    public verifySig(data: any, signature: string): boolean {
        const verificationMethod = this.doc.verificationMethod!.find(entry => entry.id == this.doc.id)
        if (!verificationMethod || !verificationMethod.publicKeyHex) {
            return false
        }



        return EncryptionUtils.verifySig(data, signature, verificationMethod.publicKeyHex!)
    }

    public verifyContextSignature(data: any, contextName: string, signature: string, contextIsHash: boolean = false) {
        let contextHash = contextName
        if (!contextIsHash) {
            contextHash = DIDDocument.generateContextHash(this.doc.id, contextName)
        }

        const publicKeyLookup = `${this.doc.id}?context=${contextHash}#sign`
        const verificationMethod = this.doc.verificationMethod!.find(entry => entry.id == publicKeyLookup)

        if (!verificationMethod) {
            return false
        }

        const signPublicKey = verificationMethod.publicKeyHex!
        return EncryptionUtils.verifySig(data, signature, signPublicKey)
    }

    private getProofData() {
        const proofData = Object.assign({}, this.doc)
        delete proofData['proof']
        return proofData
    }

    public static generateContextHash(did: string, contextName: string) {
        did = did.toLowerCase()
        return EncryptionUtils.hash(`${did}/${contextName}`)
    }

    public locateServiceEndpoint(contextName: string, endpointType: EndpointType) {
        const contextHash = DIDDocument.generateContextHash(this.doc.id, contextName)
        const expectedEndpointId = `${this.doc.id}?context=${contextHash}#${endpointType}`

        return this.doc.service!.find(entry => entry.id == expectedEndpointId)
    }

}