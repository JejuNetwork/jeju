/**
 * Contact Book Service
 * Save addresses with labels for easy access
 */

import { type Address, getAddress } from 'viem'
import { z } from 'zod'
import { storage } from '../../../web/platform/storage'
import { ContactSchema } from '../../plugin/schemas'

export interface Contact {
  id: string
  address: Address
  name: string
  label?: string
  chainIds?: number[] // Chains where this address is used
  createdAt: number
  updatedAt: number
  isFavorite: boolean
  transactionCount: number
  lastUsed?: number
}

const STORAGE_KEY = 'jeju_contacts'

class ContactsService {
  private contacts: Map<string, Contact> = new Map()

  async initialize(): Promise<void> {
    const saved = await storage.getJSON('jeju_contacts', z.array(ContactSchema))
    if (saved) {
      for (const contact of saved) {
        this.contacts.set(contact.id, contact as Contact)
      }
    }
  }

  /**
   * Add a new contact
   */
  async addContact(params: {
    address: Address
    name: string
    label?: string
    chainIds?: number[]
  }): Promise<Contact> {
    // Check for duplicates
    const existing = this.getContactByAddress(params.address)
    if (existing) {
      throw new Error('Contact with this address already exists')
    }

    const contact: Contact = {
      id: this.generateId(),
      address: getAddress(params.address),
      name: params.name,
      label: params.label,
      chainIds: params.chainIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isFavorite: false,
      transactionCount: 0,
    }

    this.contacts.set(contact.id, contact)
    await this.save()

    return contact
  }

  /**
   * Update a contact
   */
  async updateContact(
    id: string,
    updates: Partial<Omit<Contact, 'id' | 'createdAt'>>,
  ): Promise<Contact> {
    const contact = this.contacts.get(id)
    if (!contact) {
      throw new Error('Contact not found')
    }

    const updated: Contact = {
      ...contact,
      ...updates,
      updatedAt: Date.now(),
    }

    // Normalize and validate address
    if (updates.address) {
      updated.address = getAddress(updates.address)
    }

    this.contacts.set(id, updated)
    await this.save()

    return updated
  }

  /**
   * Delete a contact
   */
  async deleteContact(id: string): Promise<void> {
    this.contacts.delete(id)
    await this.save()
  }

  /**
   * Get contact by ID
   */
  getContact(id: string): Contact | undefined {
    return this.contacts.get(id)
  }

  /**
   * Get contact by address
   */
  getContactByAddress(address: Address): Contact | undefined {
    const normalized = address.toLowerCase()
    for (const contact of this.contacts.values()) {
      if (contact.address.toLowerCase() === normalized) {
        return contact
      }
    }
    return undefined
  }

  /**
   * Get all contacts
   */
  getAllContacts(): Contact[] {
    return Array.from(this.contacts.values())
  }

  /**
   * Get contacts sorted by various criteria
   */
  getContactsSorted(
    sortBy: 'name' | 'recent' | 'frequent' | 'favorite' = 'name',
  ): Contact[] {
    const contacts = this.getAllContacts()

    switch (sortBy) {
      case 'name':
        return contacts.sort((a, b) => a.name.localeCompare(b.name))
      case 'recent':
        return contacts.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
      case 'frequent':
        return contacts.sort((a, b) => b.transactionCount - a.transactionCount)
      case 'favorite':
        return contacts.sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1
          if (!a.isFavorite && b.isFavorite) return 1
          return a.name.localeCompare(b.name)
        })
      default:
        return contacts
    }
  }

  /**
   * Search contacts
   */
  searchContacts(query: string): Contact[] {
    const lowercaseQuery = query.toLowerCase()
    return this.getAllContacts().filter(
      (contact) =>
        contact.name.toLowerCase().includes(lowercaseQuery) ||
        contact.address.toLowerCase().includes(lowercaseQuery) ||
        contact.label?.toLowerCase().includes(lowercaseQuery),
    )
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(id: string): Promise<Contact> {
    const contact = this.contacts.get(id)
    if (!contact) {
      throw new Error('Contact not found')
    }

    return this.updateContact(id, { isFavorite: !contact.isFavorite })
  }

  /**
   * Record a transaction to this contact
   */
  async recordTransaction(address: Address): Promise<void> {
    const contact = this.getContactByAddress(address)
    if (contact) {
      await this.updateContact(contact.id, {
        transactionCount: contact.transactionCount + 1,
        lastUsed: Date.now(),
      })
    }
  }

  /**
   * Get recent contacts
   */
  getRecentContacts(limit: number = 5): Contact[] {
    return this.getContactsSorted('recent').slice(0, limit)
  }

  /**
   * Get favorite contacts
   */
  getFavoriteContacts(): Contact[] {
    return this.getAllContacts().filter((c) => c.isFavorite)
  }

  /**
   * Check if address is a known contact
   */
  isKnownAddress(address: Address): boolean {
    return this.getContactByAddress(address) !== undefined
  }

  /**
   * Get label for address (contact name or truncated address)
   */
  getAddressLabel(address: Address): string {
    const contact = this.getContactByAddress(address)
    if (contact) return contact.name
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  /**
   * Import contacts from JSON
   */
  async importContacts(data: Contact[]): Promise<number> {
    let imported = 0

    for (const contact of data) {
      try {
        // Skip if already exists
        if (this.getContactByAddress(contact.address)) continue

        await this.addContact({
          address: contact.address,
          name: contact.name,
          label: contact.label,
          chainIds: contact.chainIds,
        })
        imported++
      } catch {
        // Skip invalid contacts
      }
    }

    return imported
  }

  /**
   * Export contacts to JSON
   */
  exportContacts(): Contact[] {
    return this.getAllContacts()
  }

  private generateId(): string {
    return `contact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  private async save(): Promise<void> {
    const data = Array.from(this.contacts.values())
    await storage.set(STORAGE_KEY, JSON.stringify(data))
  }
}

export const contactsService = new ContactsService()
export { ContactsService }
