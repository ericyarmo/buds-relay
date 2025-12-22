/**
 * Input Validation Tests
 * Phase 3: Golden + Threat Vectors
 */

import { describe, it, expect } from 'vitest';
import { validate, schemas } from '../src/utils/validation';

describe('Input Validation', () => {
  describe('DID validation', () => {
    it('GOLDEN: accepts valid DID', () => {
      const validDIDs = [
        'did:buds:5dGHK7P9mNqR8vZw3T',
        'did:buds:abc123',
        'did:buds:XYZ789abcdef',
      ];

      validDIDs.forEach(did => {
        expect(() => validate(schemas.did, did)).not.toThrow();
      });
    });

    it('THREAT: rejects malformed DID - empty identifier', () => {
      expect(() => validate(schemas.did, 'did:buds:')).toThrow();
    });

    it('THREAT: rejects malformed DID - invalid characters', () => {
      expect(() => validate(schemas.did, 'did:buds:abc!@#$%')).toThrow();
    });

    it('THREAT: rejects malformed DID - wrong method', () => {
      expect(() => validate(schemas.did, 'did:web:example.com')).toThrow();
    });

    it('THREAT: rejects malformed DID - too long', () => {
      const longDID = 'did:buds:' + 'a'.repeat(100);
      expect(() => validate(schemas.did, longDID)).toThrow();
    });

    it('THREAT: rejects malformed DID - missing prefix', () => {
      expect(() => validate(schemas.did, 'not-a-did')).toThrow();
    });

    it('THREAT: SQL injection attempt in DID', () => {
      const sqlInjection = "did:buds:abc'); DROP TABLE devices; --";
      expect(() => validate(schemas.did, sqlInjection)).toThrow();
    });
  });

  describe('Phone hash validation', () => {
    it('GOLDEN: accepts valid SHA-256 hash', () => {
      const validHash = 'a'.repeat(64); // 64 hex characters
      expect(() => validate(schemas.phoneHash, validHash)).not.toThrow();
    });

    it('THREAT: rejects non-hex characters', () => {
      const invalidHash = 'g'.repeat(64); // 'g' is not hex
      expect(() => validate(schemas.phoneHash, invalidHash)).toThrow();
    });

    it('THREAT: rejects wrong length - too short', () => {
      const shortHash = 'a'.repeat(32); // SHA-1 length
      expect(() => validate(schemas.phoneHash, shortHash)).toThrow();
    });

    it('THREAT: rejects wrong length - too long', () => {
      const longHash = 'a'.repeat(128);
      expect(() => validate(schemas.phoneHash, longHash)).toThrow();
    });
  });

  describe('Device ID validation', () => {
    it('GOLDEN: accepts valid UUID v4', () => {
      const validUUIDs = [
        '550e8400-e29b-41d4-a716-446655440000',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ];

      validUUIDs.forEach(uuid => {
        expect(() => validate(schemas.deviceId, uuid)).not.toThrow();
      });
    });

    it('THREAT: rejects invalid UUID format', () => {
      const invalidUUIDs = [
        'not-a-uuid',
        '550e8400-e29b-41d4-a716',  // Too short
        '550e8400-e29b-41d4-a716-446655440000-extra',  // Too long
      ];

      invalidUUIDs.forEach(uuid => {
        expect(() => validate(schemas.deviceId, uuid)).toThrow();
      });
    });
  });

  describe('Base64 validation', () => {
    it('GOLDEN: accepts valid base64', () => {
      const validBase64 = [
        'SGVsbG8gV29ybGQ=',
        'YWJjMTIz',
        'dGVzdA==',
      ];

      validBase64.forEach(b64 => {
        expect(() => validate(schemas.base64, b64)).not.toThrow();
      });
    });

    it('THREAT: rejects invalid base64 characters', () => {
      expect(() => validate(schemas.base64, 'invalid!@#$%')).toThrow();
    });

    it('THREAT: rejects empty string', () => {
      expect(() => validate(schemas.base64, '')).toThrow();
    });
  });

  describe('Phone number validation', () => {
    it('GOLDEN: accepts valid E.164 phone numbers', () => {
      const validPhones = [
        '+14155551234',
        '+442071234567',
        '+33123456789',
      ];

      validPhones.forEach(phone => {
        expect(() => validate(schemas.phoneNumber, phone)).not.toThrow();
      });
    });

    it('THREAT: rejects phone without + prefix', () => {
      expect(() => validate(schemas.phoneNumber, '14155551234')).toThrow();
    });

    it('THREAT: rejects phone with invalid characters', () => {
      expect(() => validate(schemas.phoneNumber, '+1 415 555 1234')).toThrow();
    });

    it('THREAT: rejects phone starting with 0', () => {
      expect(() => validate(schemas.phoneNumber, '+01234567890')).toThrow();
    });
  });

  describe('CID validation', () => {
    it('GOLDEN: accepts valid CIDv1', () => {
      const validCIDs = [
        'bafyreigbt47gcgaqufjlk3lqfnpszxp3z7kqqdctlzqx7ow4d6cr3z5kea',
        'bafyreibvjvcv745gig4mvqs4hctx4zfkono4rjejm2ta6gtyzkqxfjeily',
      ];

      validCIDs.forEach(cid => {
        expect(() => validate(schemas.cid, cid)).not.toThrow();
      });
    });

    it('THREAT: rejects invalid CID prefix', () => {
      expect(() => validate(schemas.cid, 'Qm' + 'a'.repeat(44))).toThrow(); // CIDv0
    });

    it('THREAT: rejects CID with invalid characters', () => {
      expect(() => validate(schemas.cid, 'bafy' + 'A'.repeat(50))).toThrow(); // Uppercase not allowed in base32
    });
  });

  describe('DIDs array validation', () => {
    it('GOLDEN: accepts valid array of 1-12 DIDs', () => {
      const validArrays = [
        ['did:buds:abc123'],
        ['did:buds:abc123', 'did:buds:xyz789'],
        Array(12).fill('did:buds:test123'),
      ];

      validArrays.forEach(arr => {
        expect(() => validate(schemas.dids, arr)).not.toThrow();
      });
    });

    it('THREAT: rejects empty array', () => {
      expect(() => validate(schemas.dids, [])).toThrow();
    });

    it('THREAT: rejects more than 12 DIDs (Circle limit)', () => {
      const tooMany = Array(13).fill('did:buds:test123');
      expect(() => validate(schemas.dids, tooMany)).toThrow();
    });

    it('THREAT: rejects array with invalid DID', () => {
      const mixed = [
        'did:buds:valid123',
        'invalid-did',
        'did:buds:valid456',
      ];
      expect(() => validate(schemas.dids, mixed)).toThrow();
    });
  });

  describe('SQL injection prevention', () => {
    it('THREAT: device name with SQL injection attempt', () => {
      const sqlInjection = "Alice's iPhone'; DELETE FROM devices WHERE '1'='1";
      // Should pass validation (single quotes allowed in names)
      // But SQL injection prevented by prepared statements, not validation
      expect(() => validate(schemas.deviceName, sqlInjection)).not.toThrow();
    });

    it('THREAT: DID with SQL comment injection', () => {
      const sqlComment = "did:buds:abc--comment";
      expect(() => validate(schemas.did, sqlComment)).toThrow();
    });
  });
});
