import { IsArray, IsIn, IsString, MinLength } from 'class-validator';
import { CONSENT_DOCUMENT_TYPES, type ConsentDocumentType } from '@sassy-auth/types';

export class RecordConsentDto {
  @IsString() @MinLength(1) appPublicId!: string;
  @IsArray() @IsIn(CONSENT_DOCUMENT_TYPES, { each: true }) accepted!: ConsentDocumentType[];
}

export class GetConsentQueryDto {
  @IsString() @MinLength(1) appPublicId!: string;
}
