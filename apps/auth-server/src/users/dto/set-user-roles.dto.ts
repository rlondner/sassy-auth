import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';

// bug-0034: cap the incoming array at 100. Nothing in the current
// admin flow builds a set-replace payload with 100 entries — the
// UI's role picker is a bounded dropdown — so this is a defense
// against a client bug or a scripted misuse producing an unbounded
// payload that would blow up per-request memory + Prisma's IN clause.
const MAX_SET_REPLACE_IDS = 100;

export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_SET_REPLACE_IDS)
  @IsString({ each: true })
  roleIds!: string[];
}
