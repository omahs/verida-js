import BaseMessage from "../../../messaging";
import { MessagesConfig } from "../../../interfaces";
import Inbox from "./inbox";
import Outbox from "./outbox";
import { Keyring } from "@verida/keyring";
import { Account } from "@verida/account";
import DIDContextManager from "../../../../did-context-manager";
import Context from "../../../context";
import { MessageSendConfig } from "../../../interfaces";
import Notification from "../../../notification";
import { Client } from "../../../..";
const EventEmitter = require("events");

/**
 * @category
 * Modules
 */
class MessagingEngineVerida implements BaseMessage {
  private context: Context;
  private contextName: string;
  private maxItems: Number;
  private didContextManager: DIDContextManager;
  private notificationService?: Notification

  private did?: string;
  private keyring?: Keyring;

  private inbox?: Inbox;
  private outbox?: Outbox;

  constructor(context: Context, config: MessagesConfig = {}, notificationService?: Notification) {
    this.context = context;
    this.contextName = this.context.getContextName();
    this.maxItems = config.maxItems ? config.maxItems : 50;
    this.didContextManager = context.getDidContextManager();
    this.notificationService = notificationService
  }

  public async init(): Promise<void> {
    if (!this.keyring) {
      throw new Error(
        "Unable to initialize messaging as no account is connected"
      );
    }

    const inbox = await this.getInbox();
    await inbox.init();
  }

  public async connectAccount(account: Account) {
    this.did = await account.did();
    this.keyring = await account.keyring(this.contextName);
    await this.init();
  }

  /**
   * Send a message to another DID on the network
   *
   * @param did
   * @param type
   * @param data
   * @param message
   * @param config
   */
  public async send(
    did: string,
    type: string,
    data: object,
    message: string,
    config: MessageSendConfig
  ): Promise<object | null> {
    const outbox = await this.getOutbox();
    const response = await outbox.send(did, type, data, message, config);

    let recipientContextName = config.recipientContextName ? 
      config.recipientContextName : this.context.getClient().getConfig().vaultAppName;

    // Ping the notification service if it exists
    // @todo: Make it configurable if the notification service is pinged
    if (response && this.notificationService) {
      await this.notificationService.ping(recipientContextName, did);
    }

    return response
  }

  /**
   * Register a callback to fire when a new message is received
   *
   * @returns {EventEmitter}
   */
  public async onMessage(callback: any): Promise<EventEmitter> {
    const inbox = await this.getInbox();
    return inbox.on("newMessage", callback);
  }

  public async offMessage(callback: any): Promise<void> {
    const inbox = await this.getInbox();
    inbox.removeListener("newMessage", callback);
  }

  public async getMessages(filter?: object, options?: any): Promise<any> {
    const inbox = await this.getInbox();
    const inboxDs = await inbox.getInboxDatastore();
    return inboxDs.getMany(filter, options);
  }

  public async getInbox(): Promise<Inbox> {
    if (this.inbox) {
      return this.inbox;
    }

    this.inbox = new Inbox(this.context, this.keyring!, this.maxItems);
    return this.inbox;
  }

  private async getOutbox(): Promise<Outbox> {
    if (this.outbox) {
      return this.outbox;
    }

    const outboxDatastore = await this.context.openDatastore(
      "https://core.schemas.verida.io/outbox/entry/v0.1.0/schema.json"
    );
    this.outbox = new Outbox(
      this.contextName,
      this.did!,
      this.keyring!,
      outboxDatastore,
      this.context,
      this.didContextManager
    );
    return this.outbox;
  }
}

export default MessagingEngineVerida;
