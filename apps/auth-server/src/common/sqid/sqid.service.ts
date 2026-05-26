import { Injectable } from '@nestjs/common';
import Sqids from 'sqids';

@Injectable()
export class SqidService {
  private readonly sqids: Sqids;

  constructor() {
    const alphabet = process.env.SQIDS_ALPHABET || undefined;
    this.sqids = new Sqids({ alphabet, minLength: 4 });
  }

  encode(id: number): string {
    return this.sqids.encode([id]);
  }

  decode(publicId: string): number {
    const ids = this.sqids.decode(publicId);
    if (ids.length === 0) {
      throw new Error(`Invalid sqid: "${publicId}"`);
    }
    return ids[0];
  }
}
