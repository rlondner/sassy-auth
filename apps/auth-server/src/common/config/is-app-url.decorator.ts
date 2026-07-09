import { registerDecorator, ValidationOptions } from 'class-validator';
import { isAppUrlAllowed, isInsecureAppUrlsAllowed } from './app-url-policy';

/**
 * Validates that a property is an acceptable app/callback URL under the current
 * security policy (see app-url-policy.ts). The error message adapts to whether
 * insecure URLs are currently permitted.
 */
export function IsAppUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isAppUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isAppUrlAllowed(value);
        },
        defaultMessage() {
          return isInsecureAppUrlsAllowed()
            ? 'must be a valid http(s) URL'
            : 'must be a valid https URL with a public host';
        },
      },
    });
  };
}
