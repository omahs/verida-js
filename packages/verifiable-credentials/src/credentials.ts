import { encodeBase64 } from 'tweetnacl-util';
import { ES256KSigner } from 'did-jwt';
import { Resolver } from 'did-resolver';
import vdaResolver from '@verida/did-resolver';
import {
	createVerifiableCredentialJwt,
	createVerifiablePresentationJwt,
	verifyPresentation,
	verifyCredential,
	JwtCredentialPayload,
	Issuer,
} from 'did-jwt-vc';
import { Context, EnvironmentType } from '@verida/client-ts';
import { CreateCredentialJWT } from './interfaces';

const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
dayjs.extend(utc)

/**
 * A bare minimum class implementing the creation and verification of
 * Verifiable Credentials and Verifiable Presentations represented as
 * DID-JWT's
 */


export default class Credentials {
	private errors: string[] = [];

	/**
	 * Initialize a new credential issuer and verifier instance
	 * 
	 * @param context The context (must have an account connected) that will issue any new credentials
	 */

	/**
	 * Create a verifiable credential.
	 *
	 * @param {object} vc JSON representing a verifiable credential
	 * @param {object} issuer A credential issuer object obtained by calling `createIssuer(user)`
	 * @return {string} DID-JWT representation of the Verifiable Credential
	 */
	async createVerifiableCredential(
		vc: any,
		issuer: any
	): Promise<string> {
		// Create the payload
		const vcPayload: JwtCredentialPayload = {
			vc,
		};
		// Create the verifiable credential
		return await createVerifiableCredentialJwt(vcPayload, issuer);
	}

	/**
	 * Create a verifiable presentation that combines an array of Verifiable
	 * Credential DID-JWT's
	 *
	 * @param {array} vcJwts Array of Verifiable Credential DID-JWT's
	 * @param {object} issuer A credential issuer object obtained by calling `createIssuer(user)`
	 */
	async createVerifiablePresentation(
		vcJwts: string[],
		context: Context,
		issuer?: any,
	): Promise<string> {
		if (!issuer) {
			issuer = await this.createIssuer(context)
		}

		const vpPayload = {
			vp: {
				'@context': ['https://www.w3.org/2018/credentials/v1'],
				type: ['VerifiablePresentation'],
				verifiableCredential: vcJwts,
			},
		};

		return createVerifiablePresentationJwt(vpPayload, issuer);
	}

	/**
	 * Verify a Verifiable Presentation DID-JWT
	 *
	 * @param {string} vpJwt
	 * @param {string} didRegistryEndpoint
	 */
	static async verifyPresentation(vpJwt: string, environment: EnvironmentType): Promise<any> {
		const resolver = Credentials.getResolver(environment);
		return verifyPresentation(vpJwt, resolver);
	}

	/**
	 * Verify a Verifiable Credential DID-JWT
	 *
	 * @param {string} vcJwt
	 * @param {string} didRegistryEndpoint
	 * @param {string} currentDateTime to allow the client to migrate cases where the datetime is incorrect on the local computer
	 */
	async verifyCredential(vcJwt: string, environment: EnvironmentType, currentDateTime?: string): Promise<any> {
		const resolver = Credentials.getResolver(environment);
		const decodedCredential = await verifyCredential(vcJwt, resolver);
		if (decodedCredential) {
			const payload = decodedCredential.payload
			const vc = payload.vc

			/**
			 * The expirationDate property must be a string value of XMLSCHEMA11-2 if provided
			 * see https://www.w3.org/TR/vc-data-model/#expiration
			 */

			if (vc.expirationDate) {
				// Ensure credential hasn't expired
				let now;
				const expDate = dayjs(vc.expirationDate).utc(true)
				if (currentDateTime) {
					now = dayjs(currentDateTime).utc(true)
				} else {
					now = dayjs(new Date().toISOString()).utc(true)
				}

				if (expDate.diff(now) < 0) {
					this.errors.push('Credential has expired');
					return false;
				}
			}
		}

		return decodedCredential
	}

	/**
	 * Create an Issuer object that can issue Verifiable Credentials
	 *
	 * @param {object} user A Verida user instance
	 * @return {object} Verifiable Credential Issuer
	 */

	public async createIssuer(context: Context): Promise<Issuer> {
		const account = context.getAccount();
		const contextName = context.getContextName();
		const did = await account.did();

		const keyring = await account.keyring(contextName);
		const keys = await keyring.getKeys();
		const privateKey = encodeBase64(keys.signPrivateKey);

		const signer = ES256KSigner(privateKey);

		const issuer = {
			did,
			signer,
			alg: 'ES256K',
		} as Issuer;

		return issuer;
	}

	/**
	 * Create a new credential DID-JWT for a given object.
	 * 
	 * A new property `didJwtVc` is added to the data and included in the response
	 * 
	 * @param data 
	 * @returns 
	 */
	async createCredentialJWT({ subjectId, data, context, options }: CreateCredentialJWT): Promise<object> {
		// Ensure a credential schema has been specified
		if (!data.schema) {
			throw new Error('No schema specified')
		}

		// Ensure data matches specified schema
		const schema = await context.getClient().getSchema(data.schema)
		const schemaJson = await schema.getSpecification();

		const databaseName = schemaJson['database']['name']

		// Before validating, we need to ensure there is a `didJwtVc` attribute on the data
		// `didJwtVc` is a required field, but will only be set upon completion  of this
		// creation process.
		// @see https://github.com/verida/verida-js/pull/163
		const dataClone = Object.assign({}, data);
		dataClone['didJwtVc'] = 'ABC'
		const isValid = await schema.validate(dataClone);

		if (schemaJson && databaseName === 'credential') {
			if (!schemaJson.properties.didJwtVc) {
				throw new Error('Schema is not a valid credential schema')
			}
		}

		if (!isValid) {
			this.errors = schema.errors
			throw new Error('Data does not match specified schema')
		}

		const issuer = await this.createIssuer(context);
		const account = context.getAccount();
		const did = await account.did();

		const vcPayload: any = {
			'@context': [
				'https://www.w3.org/2018/credentials/v1',
				'https://www.w3.org/2018/credentials/examples/v1',
			],
			sub: subjectId,
			type: ['VerifiableCredential'],
			issuer: did,
			veridaContextName: context.getContextName(),
			issuanceDate: new Date().toISOString(),
			credentialSubject: {
				...data
			},
			credentialSchema: {
				id: data.schema,
				type: 'JsonSchemaValidator2018',
			},
		};
		if (options && options.expirationDate) {
			// The DID JWT VC library (called by createVerifiableCredential) verifies the string format so we do not need a test for that
			const dateFormat = dayjs(options.expirationDate).utc(true)
			if (dateFormat.$d.toString() === 'Invalid Date') {
				throw new Error('Date format does not match ISO standard')
			}
			vcPayload.expirationDate = options.expirationDate
		}

		if (options && options.issuanceDate) {
			const dateFormat = dayjs(options.issuanceDate).utc(true)
			if (dateFormat.$d.toString() === 'Invalid Date') {
				throw new Error('Date format does not match ISO standard')
			}

			vcPayload.issuanceDate = dateFormat.$d
		}
		const didJwtVc = await this.createVerifiableCredential(vcPayload, issuer);

		data['didJwtVc'] = didJwtVc

		return data
	}

	private static getResolver(environment: EnvironmentType): any {
		const resolver = vdaResolver.getResolver(environment);
		return new Resolver(resolver);
	}

	public getErrors() {
		return this.errors;
	}
}
