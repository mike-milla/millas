'use strict';

const Controller = require('../controller/Controller');
const Auth       = require('./Auth');
const { string, email } = require('../validation/Validator');

/**
 * AuthController
 *
 * Drop-in authentication controller using the new ctx signature.
 * All methods receive RequestContext and return MillasResponse.
 */
class AuthController extends Controller {

  async register({ body }) {
    const data = await body.validate({
      name:     string().required().min(2).max(100),
      email:    email().required(),
      password: string().required().min(8),
    });

    const user  = await Auth.register(data);
    const token = Auth.issueToken(user);

    return this.created({
      message: 'Registration successful',
      user:    this._safeUser(user),
      token,
    });
  }

  async login({ body }) {
    const { email: emailVal, password } = await body.validate({
      email:    email().required(),
      password: string().required(),
    });

    const { user, token, refreshToken } = await Auth.login(emailVal, password);

    return this.ok({
      message: 'Login successful',
      user:    this._safeUser(user),
      token,
      refresh_token: refreshToken,
    });
  }

  async logout() {
    return this.ok({ message: 'Logged out successfully' });
  }

  async me({ user }) {
    if (!user) {
      const HttpError = require('../errors/HttpError');
      throw new HttpError(401, 'Unauthenticated');
    }
    return this.ok({ user: this._safeUser(user) });
  }

  async refresh({ body }) {
    const { refresh_token } = await body.validate({
      refresh_token: string().required(),
    });

    const tokens = await Auth.refresh(refresh_token);
    return this.ok(tokens);
  }

  async forgotPassword({ body }) {
    const { email: emailVal } = await body.validate({
      email: email().required(),
    });

    await Auth.sendPasswordResetEmail(emailVal);
    return this.ok({ message: 'Password reset email sent' });
  }

  async resetPassword({ body }) {
    const { token, password } = await body.validate({
      token:    string().required(),
      password: string().required().min(8).confirmed(),
    });

    await Auth.resetPassword(token, password);
    return this.ok({ message: 'Password reset successfully' });
  }

  _safeUser(user) {
    if (!user) return null;
    // Use the model's toSafeObject() if defined (AuthUser and subclasses provide this)
    if (typeof user.toSafeObject === 'function') return user.toSafeObject();
    const data = user.toJSON ? user.toJSON() : { ...user };
    delete data.password;
    delete data.remember_token;
    return data;
  }
}

module.exports = AuthController;