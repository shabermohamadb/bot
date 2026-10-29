import { describe, it, expect } from 'vitest';
import { parseRegistrationMessage } from '../src/validation/registrationSchemas';

describe('Message Parsing Tests', () => {
  const options = {
    botUserId: '123456789012345678',
    botAlias: 'Raid master',
    prefix: '!',
  };

  it('Parses bot mention with role number: <@botId> 1', () => {
    const res = parseRegistrationMessage('<@123456789012345678> 1', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(false);
    expect(res.roleNumber).toBe(1);
  });

  it('Parses bot mention with nickname format: <@!botId> 3', () => {
    const res = parseRegistrationMessage('<@!123456789012345678> 3', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(false);
    expect(res.roleNumber).toBe(3);
  });

  it('Parses alias mention: @Raid master 2', () => {
    const res = parseRegistrationMessage('@Raid master 2', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(false);
    expect(res.roleNumber).toBe(2);
  });

  it('Parses unregister token: @Raid master -', () => {
    const res = parseRegistrationMessage('@Raid master -', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(true);
  });

  it('Parses prefix command: !1', () => {
    const res = parseRegistrationMessage('!1', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(false);
    expect(res.roleNumber).toBe(1);
  });

  it('Parses prefix unregister: !-', () => {
    const res = parseRegistrationMessage('!-', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.isUnregister).toBe(true);
  });

  it('Ignores unrelated normal chat messages', () => {
    const res1 = parseRegistrationMessage('Hey guys, what time is the AVA run?', options);
    expect(res1.isTargetedAtBot).toBe(false);

    const res2 = parseRegistrationMessage('I have 1600 IP on my shadowcaller', options);
    expect(res2.isTargetedAtBot).toBe(false);
  });

  it('Rejects invalid registration token when bot is mentioned', () => {
    const res = parseRegistrationMessage('@Raid master DPS', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('Invalid registration token');
  });

  it('Handles mention with no arguments', () => {
    const res = parseRegistrationMessage('<@123456789012345678>', options);
    expect(res.isTargetedAtBot).toBe(true);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('Please specify a role number');
  });
});
