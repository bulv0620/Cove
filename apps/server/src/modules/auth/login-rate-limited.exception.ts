import { HttpException, HttpStatus } from '@nestjs/common';

export class LoginRateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        code: 'AUTH_RATE_LIMITED',
        message: 'Too many login attempts. Try again later.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
