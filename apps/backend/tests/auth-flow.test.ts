process.env.NODE_ENV = 'test';
process.env.TELLAS_TEST = 'true';
import { buildApp } from '../src/index';
import { db } from '../src/db/database';
import { userRepository } from '../src/db/userRepository';



async function runTests() {
  console.log('🧪 Starting Auth Flow & Security Tests...\n');
  const app = await buildApp();
  await app.ready();

  const testEmail = `test_${Date.now()}@example.com`;
  const testUsername = `user_${Date.now()}`;
  const strongPassword = 'StrongPass!123';

  try {
    // 1. Weak password registration test
    console.log('Test 1: Weak password validation rejection');
    const weakRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'weakuser',
        email: 'weak@example.com',
        password: 'weak',
      },
    });
    if (weakRes.statusCode !== 400) throw new Error(`Expected 400 for weak password, got ${weakRes.statusCode}`);
    console.log('  ✅ Rejected weak password correctly');

    // 2. Successful Registration
    console.log('Test 2: Valid Registration');
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: testUsername,
        email: testEmail,
        password: strongPassword,
      },
    });
    if (regRes.statusCode !== 201) throw new Error(`Expected 201 for valid registration, got ${regRes.statusCode}: ${regRes.body}`);
    const regBody = JSON.parse(regRes.body);
    if (!regBody.tokens?.accessToken || !regBody.tokens?.refreshToken) throw new Error('Missing tokens in registration response');
    if (regBody.user.email !== testEmail) throw new Error('User email mismatch');
    console.log('  ✅ User registered successfully with JWT and Refresh Token');

    // 3. Duplicate email test
    console.log('Test 3: Duplicate Registration prevention');
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: `diff_${Date.now()}`,
        email: testEmail,
        password: strongPassword,
      },
    });
    if (dupRes.statusCode !== 400) throw new Error(`Expected 400 for duplicate email, got ${dupRes.statusCode}`);
    console.log('  ✅ Duplicate registration blocked correctly');

    // 4. Login with wrong password
    console.log('Test 4: Invalid Password Login');
    const wrongLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        emailOrUsername: testEmail,
        password: 'WrongPassword!123',
      },
    });
    if (wrongLoginRes.statusCode !== 401) throw new Error(`Expected 401 for wrong password, got ${wrongLoginRes.statusCode}`);
    console.log('  ✅ Wrong password rejected with 401');

    // 5. Successful Login
    console.log('Test 5: Valid Login with email and username');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        emailOrUsername: testUsername,
        password: strongPassword,
      },
    });
    if (loginRes.statusCode !== 200) throw new Error(`Expected 200 for valid login, got ${loginRes.statusCode}: ${loginRes.body}`);
    const loginBody = JSON.parse(loginRes.body);
    const { accessToken, refreshToken } = loginBody.tokens;
    console.log('  ✅ Logged in successfully');

    // 6. Access /api/auth/me
    console.log('Test 6: Authenticated /api/auth/me');
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (meRes.statusCode !== 200) throw new Error(`Expected 200 for /me, got ${meRes.statusCode}`);
    const meBody = JSON.parse(meRes.body);
    if (meBody.user.username !== testUsername) throw new Error('Username mismatch in /me');
    console.log('  ✅ Profile fetched successfully via Bearer token');

    // 7. Token Refresh Rotation
    console.log('Test 7: Token Refresh & Rotation');
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    if (refreshRes.statusCode !== 200) throw new Error(`Expected 200 for token refresh, got ${refreshRes.statusCode}`);
    const refreshBody = JSON.parse(refreshRes.body);
    if (!refreshBody.tokens?.accessToken || !refreshBody.tokens?.refreshToken) throw new Error('Missing rotated tokens');
    console.log('  ✅ Token rotated and refreshed successfully');

    // 8. Old refresh token should now be invalid
    console.log('Test 8: Old Refresh Token Revocation on rotation');
    const oldRefreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    if (oldRefreshRes.statusCode !== 401) throw new Error(`Expected 401 for reused refresh token, got ${oldRefreshRes.statusCode}`);
    console.log('  ✅ Reused refresh token rejected securely');

    // 9. Logout
    console.log('Test 9: Logout & Token Revocation');
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: refreshBody.tokens.refreshToken },
    });
    if (logoutRes.statusCode !== 200) throw new Error(`Expected 200 for logout, got ${logoutRes.statusCode}`);

    // A token explicitly revoked by logout must never be reusable.
    const loggedOutRefreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refreshBody.tokens.refreshToken },
    });
    if (loggedOutRefreshRes.statusCode !== 401) throw new Error(`Expected 401 after logout, got ${loggedOutRefreshRes.statusCode}`);

    // Changing a password must revoke every active refresh session.
    const sessionA = JSON.parse((await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { emailOrUsername: testEmail, password: strongPassword },
    })).body);
    const sessionB = JSON.parse((await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { emailOrUsername: testEmail, password: strongPassword },
    })).body);
    const passwordChangeRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { authorization: `Bearer ${sessionA.tokens.accessToken}` },
      payload: { currentPassword: strongPassword, newPassword: 'ChangedPass!456' },
    });
    if (passwordChangeRes.statusCode !== 200) throw new Error(`Expected 200 changing password, got ${passwordChangeRes.statusCode}: ${passwordChangeRes.body}`);
    const staleAccessRes = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionB.tokens.accessToken}` },
    });
    if (staleAccessRes.statusCode !== 401) throw new Error(`Expected 401 for access token invalidated by password change, got ${staleAccessRes.statusCode}`);
    for (const token of [sessionA.tokens.refreshToken, sessionB.tokens.refreshToken]) {
      const revokedRes = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: token } });
      if (revokedRes.statusCode !== 401) throw new Error(`Expected 401 for session revoked by password change, got ${revokedRes.statusCode}`);
    }
    const oldPasswordLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { emailOrUsername: testEmail, password: strongPassword },
    });
    if (oldPasswordLogin.statusCode !== 401) throw new Error(`Expected old password to be rejected, got ${oldPasswordLogin.statusCode}`);
    console.log('  ✅ Logout successful');

    console.log('\n🎉 ALL AUTHENTICATION & SECURITY TESTS PASSED!\n');
  } finally {
    await app.close();
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
