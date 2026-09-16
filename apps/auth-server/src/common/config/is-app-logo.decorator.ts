import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidAppLogoDataUri } from '@sassy-auth/types';

/**
 * Validates that a property is an acceptable app logo: a data URI of an
 * allowed image mime type, within the shared size cap. Mirrors IsAppUrl's
 * structure (app-url-policy.ts / is-app-url.decorator.ts) — the actual rule
 * lives in @sassy-auth/types so the admin console's client-side file picker
 * enforces the identical rule before it ever reaches this decorator.
 */
export function IsAppLogo(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isAppLogo',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidAppLogoDataUri(value);
        },
        defaultMessage() {
          return 'must be a data URI of an allowed image type (png, jpeg, webp, svg) within the size limit';
        },
      },
    });
  };
}
