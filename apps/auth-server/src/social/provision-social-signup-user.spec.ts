import { APIError } from 'better-auth/api';
import { provisionSocialSignupUser } from './provision-social-signup-user';

function makeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    saApp: { findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    user: { delete: jest.fn() },
    saAuditEvent: { create: jest.fn() },
    ...overrides,
  } as any;
}

const BASE_INPUT = {
  betterAuthUserId: 'ba-user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  provider: 'google',
  clientId: 'sq_app1',
  givenName: null as string | null,
  familyName: null as string | null,
};

describe('provisionSocialSignupUser', () => {
  it('provisions an active SaUser into the app default org/role when eligible', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({
      id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: 20,
    });
    db.saUser.create.mockResolvedValue({ id: 100, publicId: 'ba-user-1'.slice(0, 12) });

    await provisionSocialSignupUser(db, BASE_INPUT);

    expect(db.saUser.create).toHaveBeenCalledWith({
      data: {
        publicId: 'ba-user-1'.slice(0, 12),
        betterAuthUserId: 'ba-user-1',
        orgId: 10,
        firstName: 'Jane',
        lastName: 'Doe',
        status: 'active',
      },
    });
    expect(db.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 100, roleId: 20 } });
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(db.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'social.signup.created',
        provider: 'google',
        betterAuthUserId: 'ba-user-1',
        appPublicId: 'sq_app1',
      }),
    });
  });

  it('uses givenName/familyName when both are captured', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: 20 });
    db.saUser.create.mockResolvedValue({ id: 100, publicId: 'x' });

    await provisionSocialSignupUser(db, { ...BASE_INPUT, givenName: 'Ada', familyName: 'Lovelace' });

    expect(db.saUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace' }) }),
    );
  });

  it('deletes the User row and throws an APIError when the app has no defaultOrgId', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: null, defaultRoleId: 20 });

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
    expect(db.saUser.create).not.toHaveBeenCalled();
  });

  it('deletes the User row and throws an APIError when the app has no defaultRoleId', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: null });

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('deletes the User row and throws an APIError when clientId is null (unresolvable)', async () => {
    const db = makeDb();

    await expect(provisionSocialSignupUser(db, { ...BASE_INPUT, clientId: null })).rejects.toThrow(APIError);
    expect(db.saApp.findUnique).not.toHaveBeenCalled();
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('deletes the User row and throws an APIError when clientId does not resolve to any app', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue(null);

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('the thrown APIError message is exactly social_signup_unavailable (survives split/join unchanged)', async () => {
    const db = makeDb();
    await expect(provisionSocialSignupUser(db, { ...BASE_INPUT, clientId: null })).rejects.toThrow(
      'social_signup_unavailable',
    );
  });
});
