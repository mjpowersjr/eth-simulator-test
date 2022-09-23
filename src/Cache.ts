export class Cache {
    data : {
      [key: string]: Buffer;
    }
  
    constructor() {
      this.data = {};
    }
  
    async get({key} : {key: string}) : Promise<Buffer|null> {
      return this.data[key] || null;
    }
  
    async set({key, value} : {key: string, value: Buffer}) : Promise<void> {
      this.data[key] = value;
    }
  }
  