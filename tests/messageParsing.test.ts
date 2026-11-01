import { describe, it, expect } from 'vitest';
import { parseRegistrationMessage } from '../src/validation/registrationSchemas';

describe('Message Parsing Tests — Dual Registration Methods', () => {
  const options = {
    botUserId: '1565345488507773013',
    botAlias: ['Party Raid', 'Party Raid#9161', 'Raid master'],
    prefix: '!',
  };

  describe('1. Method 1 — Bot Mention Registration', () => {
    it('Parses bot mention with role numbers 1 to 5: <@botId> 1..5', () => {
      for (let role = 1; role <= 5; role++) {
        const res = parseRegistrationMessage(`<@1565345488507773013> ${role}`, options);
        expect(res.isTargetedAtBot).toBe(true);
        expect(res.isUnregister).toBe(false);
        expect(res.roleNumber).toBe(role);
      }
    });

    it('Parses bot mention with nickname format: <@!botId> 3', () => {
      const res = parseRegistrationMessage('<@!1565345488507773013> 3', options);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(false);
      expect(res.roleNumber).toBe(3);
    });

    it('Parses @Party Raid alias mention: @Party Raid 1 through 5', () => {
      const roles = [
        { num: 1, label: 'TANK' },
        { num: 2, label: 'HEAL' },
        { num: 3, label: 'DPS CULTIST' },
        { num: 4, label: 'DPS MANA' },
        { num: 5, label: 'DPS STALKER' },
      ];

      for (const r of roles) {
        const res = parseRegistrationMessage(`@Party Raid ${r.num}`, options);
        expect(res.isTargetedAtBot).toBe(true);
        expect(res.isUnregister).toBe(false);
        expect(res.roleNumber).toBe(r.num);
      }
    });

    it('Parses unregister token with mention: @Party Raid -', () => {
      const res = parseRegistrationMessage('@Party Raid -', options);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(true);
    });

    it('Parses unregister aliases with mention: @Party Raid unregister / remove', () => {
      const res1 = parseRegistrationMessage('@Party Raid unregister', options);
      expect(res1.isTargetedAtBot).toBe(true);
      expect(res1.isUnregister).toBe(true);

      const res2 = parseRegistrationMessage('@Party Raid remove', options);
      expect(res2.isTargetedAtBot).toBe(true);
      expect(res2.isUnregister).toBe(true);
    });

    it('Parses prefix command: !1 through !5 and !-', () => {
      const res = parseRegistrationMessage('!1', options);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(false);
      expect(res.roleNumber).toBe(1);

      const resUnreg = parseRegistrationMessage('!-', options);
      expect(resUnreg.isTargetedAtBot).toBe(true);
      expect(resUnreg.isUnregister).toBe(true);
    });

    it('Validates role numbers 1 to 5 on bot mention: rejects 0 or 6', () => {
      const res0 = parseRegistrationMessage('@Party Raid 0', options);
      expect(res0.isTargetedAtBot).toBe(true);
      expect(res0.error).toContain('Role number must be between 1 and 5');

      const res6 = parseRegistrationMessage('@Party Raid 6', options);
      expect(res6.isTargetedAtBot).toBe(true);
      expect(res6.error).toContain('Role number must be between 1 and 5');
    });

    it('Rejects invalid registration token when bot is mentioned', () => {
      const res = parseRegistrationMessage('@Party Raid DPS', options);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.error).toBeDefined();
      expect(res.error).toContain('Invalid registration token');
    });

    it('Handles mention with no arguments', () => {
      const res = parseRegistrationMessage('<@1565345488507773013>', options);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.error).toBeDefined();
      expect(res.error).toContain('Please specify a role number');
    });
  });

  describe('2. Method 2 — Reply-Based Registration', () => {
    const replyOptions = {
      ...options,
      isReplyToBot: true,
    };

    it('Accepts standalone role numbers 1 to 5 when replying to bot', () => {
      for (let role = 1; role <= 5; role++) {
        const res = parseRegistrationMessage(`${role}`, replyOptions);
        expect(res.isTargetedAtBot).toBe(true);
        expect(res.isUnregister).toBe(false);
        expect(res.roleNumber).toBe(role);
      }
    });

    it('Accepts role numbers with hashtag prefix: #1 to #5', () => {
      const res = parseRegistrationMessage('#1', replyOptions);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(false);
      expect(res.roleNumber).toBe(1);
    });

    it('Accepts role prefix and variations: role 2, Role 3, r1, 1.', () => {
      const res1 = parseRegistrationMessage('role 2', replyOptions);
      expect(res1.isTargetedAtBot).toBe(true);
      expect(res1.roleNumber).toBe(2);

      const res2 = parseRegistrationMessage('Role 3', replyOptions);
      expect(res2.isTargetedAtBot).toBe(true);
      expect(res2.roleNumber).toBe(3);

      const res3 = parseRegistrationMessage('r4', replyOptions);
      expect(res3.isTargetedAtBot).toBe(true);
      expect(res3.roleNumber).toBe(4);

      const res4 = parseRegistrationMessage('5.', replyOptions);
      expect(res4.isTargetedAtBot).toBe(true);
      expect(res4.roleNumber).toBe(5);
    });

    it('Accepts unregister token "-" when replying to bot', () => {
      const res = parseRegistrationMessage('-', replyOptions);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(true);
    });

    it('Accepts "unregister", "remove", "cancel", and "leave" when replying to bot', () => {
      for (const token of ['unregister', 'remove', 'cancel', 'leave']) {
        const res = parseRegistrationMessage(token, replyOptions);
        expect(res.isTargetedAtBot).toBe(true);
        expect(res.isUnregister).toBe(true);
      }
    });

    it('Accepts reply that includes bot mention: @Party Raid 2', () => {
      const res = parseRegistrationMessage('@Party Raid 2', replyOptions);
      expect(res.isTargetedAtBot).toBe(true);
      expect(res.isUnregister).toBe(false);
      expect(res.roleNumber).toBe(2);
    });

    it('Rejects role number out of range (0 or 6-9) when replying to bot', () => {
      const res0 = parseRegistrationMessage('0', replyOptions);
      expect(res0.isTargetedAtBot).toBe(true);
      expect(res0.error).toContain('Role number must be between 1 and 5');

      const res6 = parseRegistrationMessage('6', replyOptions);
      expect(res6.isTargetedAtBot).toBe(true);
      expect(res6.error).toContain('Role number must be between 1 and 5');
    });

    it('Ignores unrelated numbers (>9) like IP values in reply: 1450, 1500', () => {
      const res1 = parseRegistrationMessage('1500', replyOptions);
      expect(res1.isTargetedAtBot).toBe(false);

      const res2 = parseRegistrationMessage('1450', replyOptions);
      expect(res2.isTargetedAtBot).toBe(false);
    });

    it('Ignores conversational text in replies to bot: "hello", "what time is it"', () => {
      const res1 = parseRegistrationMessage('hello bot', replyOptions);
      expect(res1.isTargetedAtBot).toBe(false);

      const res2 = parseRegistrationMessage('can I bring 1600 IP?', replyOptions);
      expect(res2.isTargetedAtBot).toBe(false);
    });
  });

  describe('3. Important Message Detection — Protection Against Unintended Triggers', () => {
    it('DOES NOT process standalone numbers sent as ordinary messages (not replying to bot)', () => {
      // Ordinary chat where isReplyToBot is false / undefined
      for (let role = 1; role <= 5; role++) {
        const res = parseRegistrationMessage(`${role}`, options);
        expect(res.isTargetedAtBot).toBe(false);
      }
    });

    it('DOES NOT process standalone "-" sent as ordinary message without bot mention', () => {
      const res = parseRegistrationMessage('-', options);
      expect(res.isTargetedAtBot).toBe(false);
    });

    it('DOES NOT process when replying to another user (isReplyToBot is false)', () => {
      const otherUserReplyOptions = {
        ...options,
        isReplyToBot: false,
      };

      const res = parseRegistrationMessage('1', otherUserReplyOptions);
      expect(res.isTargetedAtBot).toBe(false);
    });

    it('Ignores normal discussion and IP chatter in party threads', () => {
      expect(parseRegistrationMessage('Hey guys, what time is the AVA run?', options).isTargetedAtBot).toBe(false);
      expect(parseRegistrationMessage('I have 1600 IP on my shadowcaller', options).isTargetedAtBot).toBe(false);
      expect(parseRegistrationMessage('We need 1 more DPS', options).isTargetedAtBot).toBe(false);
    });
  });
});
