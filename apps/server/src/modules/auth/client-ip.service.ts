import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import ipaddr from 'ipaddr.js';
import { LoginThrottleConfig } from './login-throttle.config';

export interface ClientIp {
  address: string;
  throttleValue: string;
}

function parseAddress(input: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  let value = input.trim();
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  if (!ipaddr.isValid(value)) {
    const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
    if (!ipv4WithPort || !ipaddr.isValid(ipv4WithPort[1]!)) return null;
    value = ipv4WithPort[1]!;
  }
  const parsed = ipaddr.parse(value);
  return parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed;
}

function normalized(address: ipaddr.IPv4 | ipaddr.IPv6): string {
  return address.kind() === 'ipv6' ? address.toNormalizedString() : address.toString();
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

function forwardedAddresses(value: string): Array<ipaddr.IPv4 | ipaddr.IPv6> | null {
  const result: Array<ipaddr.IPv4 | ipaddr.IPv6> = [];
  for (const element of value.split(',')) {
    const parameter = element
      .split(';')
      .map((part) => part.trim())
      .find((part) => /^for=/i.test(part));
    if (!parameter) return null;
    let address = parameter.slice(parameter.indexOf('=') + 1).trim();
    if (address.startsWith('"') && address.endsWith('"')) {
      address = address.slice(1, -1);
    }
    if (!address || /["\\]/.test(address) || address.toLowerCase() === 'unknown') return null;
    const parsed = parseAddress(address);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

function xForwardedAddresses(value: string): Array<ipaddr.IPv4 | ipaddr.IPv6> | null {
  const result = value.split(',').map((part) => parseAddress(part));
  return result.every((address) => address !== null)
    ? (result as Array<ipaddr.IPv4 | ipaddr.IPv6>)
    : null;
}

@Injectable()
export class ClientIpService {
  constructor(private readonly config: LoginThrottleConfig) {}

  resolve(request: Request): ClientIp {
    const direct = parseAddress(request.socket.remoteAddress ?? '') ?? ipaddr.parse('0.0.0.0');
    let selected = direct;

    if (this.isTrusted(direct)) {
      const forwarded = header(request, 'forwarded');
      const xForwarded = header(request, 'x-forwarded-for');
      const standardChain = forwarded ? forwardedAddresses(forwarded) : undefined;
      const legacyChain = xForwarded ? xForwardedAddresses(xForwarded) : undefined;
      const malformed =
        (forwarded !== undefined && standardChain === null) ||
        (xForwarded !== undefined && legacyChain === null);
      const chainsAgree =
        standardChain === undefined ||
        legacyChain === undefined ||
        standardChain?.map(normalized).join(',') === legacyChain?.map(normalized).join(',');
      const chain = !malformed && chainsAgree ? (standardChain ?? legacyChain) : null;
      if (chain?.length) {
        const hops = [...chain, direct];
        selected = hops[0]!;
        for (let index = hops.length - 1; index >= 0; index -= 1) {
          const hop = hops[index]!;
          if (!this.isTrusted(hop)) {
            selected = hop;
            break;
          }
        }
      }
    }

    const address = normalized(selected);
    const prefixBytes = selected.toByteArray().slice(0, 8);
    const ipv6Prefix =
      selected.kind() === 'ipv6'
        ? ipaddr.fromByteArray([...prefixBytes, 0, 0, 0, 0, 0, 0, 0, 0]).toNormalizedString()
        : null;
    return {
      address,
      throttleValue: selected.kind() === 'ipv6' ? `${ipv6Prefix}/64` : `${address}/32`,
    };
  }

  private isTrusted(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
    return this.config.trustedProxyCidrs.some(([range, prefix]) => {
      if (range.kind() !== address.kind()) return false;
      return address.match(range, prefix);
    });
  }
}
