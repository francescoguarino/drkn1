import { EventEmitter } from 'events';

export class BlockchainEventEmitter extends EventEmitter {
  constructor() {
    super();
  }

  emitBlockAdded(block) {
    this.emit('block:added', block);
  }

  emitTransactionAdded(transaction) {
    this.emit('transaction:added', transaction);
  }

  emitBlockchainSync(height) {
    this.emit('blockchain:sync', height);
  }

  emitError(error) {
    this.emit('error', error);
  }
}
