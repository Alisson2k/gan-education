export default class MemoryStore {
    constructor() {
        this.store = new Map();
    }

    set(key, value) {
        if (typeof key !== 'string') {
            throw new Error('Key must be a string');
        }
        if (typeof value !== 'object' || value === null) {
            throw new Error('Value must be an object');
        }
        this.store.set(key, value);
    }

    get(key) {
        return this.store.get(key);
    }

    delete(key) {
        this.store.delete(key);
    }

    clear() {
        this.store.clear();
    }
}