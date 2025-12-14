/**
 * Contacts Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsService } from './index';

// Mock storage
vi.mock('../../platform/storage', () => ({
  storage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('ContactsService', () => {
  let contactsService: ContactsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    contactsService = new ContactsService();
    await contactsService.initialize();
  });

  describe('addContact', () => {
    it('should add a new contact', async () => {
      const contact = await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      expect(contact.name).toBe('Alice');
      expect(contact.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(contact.isFavorite).toBe(false);
      expect(contact.transactionCount).toBe(0);
    });

    it('should normalize address to lowercase', async () => {
      const contact = await contactsService.addContact({
        address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        name: 'Bob',
      });

      expect(contact.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });

    it('should reject duplicate addresses', async () => {
      await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      await expect(
        contactsService.addContact({
          address: '0x1234567890abcdef1234567890abcdef12345678',
          name: 'Alice 2',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('getContactByAddress', () => {
    it('should find contact by address', async () => {
      await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      const found = contactsService.getContactByAddress(
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(found).toBeDefined();
      expect(found?.name).toBe('Alice');
    });

    it('should return undefined for unknown address', () => {
      const found = contactsService.getContactByAddress(
        '0x0000000000000000000000000000000000000000'
      );

      expect(found).toBeUndefined();
    });
  });

  describe('updateContact', () => {
    it('should update contact name', async () => {
      const contact = await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      const updated = await contactsService.updateContact(contact.id, {
        name: 'Alice Updated',
      });

      expect(updated.name).toBe('Alice Updated');
    });

    it('should throw for non-existent contact', async () => {
      await expect(
        contactsService.updateContact('invalid-id', { name: 'Test' })
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteContact', () => {
    it('should remove contact', async () => {
      const contact = await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      await contactsService.deleteContact(contact.id);

      const found = contactsService.getContact(contact.id);
      expect(found).toBeUndefined();
    });
  });

  describe('searchContacts', () => {
    it('should find contacts by name', async () => {
      await contactsService.addContact({
        address: '0x1111111111111111111111111111111111111111',
        name: 'Alice',
      });
      await contactsService.addContact({
        address: '0x2222222222222222222222222222222222222222',
        name: 'Bob',
      });

      const results = contactsService.searchContacts('ali');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('should find contacts by address', async () => {
      await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      const results = contactsService.searchContacts('1234');

      expect(results).toHaveLength(1);
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle favorite status', async () => {
      const contact = await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      expect(contact.isFavorite).toBe(false);

      const updated = await contactsService.toggleFavorite(contact.id);
      expect(updated.isFavorite).toBe(true);

      const updated2 = await contactsService.toggleFavorite(contact.id);
      expect(updated2.isFavorite).toBe(false);
    });
  });

  describe('recordTransaction', () => {
    it('should increment transaction count', async () => {
      const contact = await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      expect(contact.transactionCount).toBe(0);

      await contactsService.recordTransaction('0x1234567890abcdef1234567890abcdef12345678');

      const updated = contactsService.getContact(contact.id);
      expect(updated?.transactionCount).toBe(1);
    });
  });

  describe('getAddressLabel', () => {
    it('should return contact name if exists', async () => {
      await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      const label = contactsService.getAddressLabel('0x1234567890abcdef1234567890abcdef12345678');
      expect(label).toBe('Alice');
    });

    it('should return truncated address if no contact', () => {
      const label = contactsService.getAddressLabel('0x1234567890abcdef1234567890abcdef12345678');
      expect(label).toBe('0x1234...5678');
    });
  });

  describe('exportContacts / importContacts', () => {
    it('should export and import contacts', async () => {
      await contactsService.addContact({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        name: 'Alice',
      });

      const exported = contactsService.exportContacts();
      expect(exported).toHaveLength(1);

      // Create new service to import
      const newService = new ContactsService();
      await newService.initialize();

      const imported = await newService.importContacts(exported);
      expect(imported).toBe(1);
    });
  });
});

