import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface ConsentRecord {
  expiry: number;
  active: boolean;
}

interface HistoryEntry {
  block: number;
  action: string;
  details: string;
}

interface TemplateRecord {
  categories: string[];
  duration: number;
  description: string;
}

interface ContractState {
  consents: Map<string, ConsentRecord>; // key: `${granter}-${grantee}-${category}`
  validCategories: Map<string, boolean>;
  consentHistory: Map<string, HistoryEntry[]>;
  delegatedManagers: Map<string, string[]>;
  consentTemplates: Map<string, TemplateRecord>;
  initialized: boolean;
}

// Mock contract implementation
class ConsentManagerMock {
  private state: ContractState = {
    consents: new Map(),
    validCategories: new Map(),
    consentHistory: new Map(),
    delegatedManagers: new Map(),
    consentTemplates: new Map(),
    initialized: false,
  };

  private currentBlockHeight: number = 0;

  private ERR_NOT_AUTHORIZED = 100;
  private ERR_CONSENT_EXPIRED = 101;
  private ERR_INVALID_CATEGORY = 102;
  private ERR_ALREADY_GRANTED = 103;
  private ERR_NOT_FOUND = 104;
  private ERR_NOT_DELEGATED = 105;
  private ERR_TEMPLATE_NOT_FOUND = 106;
  private ERR_INVALID_DURATION = 107;
  private ERR_HISTORY_LIMIT_EXCEEDED = 108;
  private ERR_MAX_DELEGATES_REACHED = 109;
  private ERR_INVALID_TEMPLATE = 110;

  private MAX_HISTORY_ENTRIES = 50;
  private MAX_DELEGATES = 10;
  private MAX_CATEGORIES_PER_TEMPLATE = 10;

  // Simulate block height
  advanceBlock(blocks: number = 1): void {
    this.currentBlockHeight += blocks;
  }

  // Private: Initialize categories
  private initializeCategories(): void {
    if (this.state.initialized) return;
    this.state.validCategories.set("medical-history", true);
    this.state.validCategories.set("vaccinations", true);
    this.state.validCategories.set("allergies", true);
    this.state.validCategories.set("medications", true);
    this.state.validCategories.set("lab-results", true);
    this.state.validCategories.set("mental-health", true);
    this.state.validCategories.set("imaging", true);
    this.state.validCategories.set("genetics", true);
    this.state.initialized = true;
  }

  // Private: Add to history
  private addToHistory(granter: string, grantee: string, category: string, action: string, details: string): void {
    const key = `${granter}-${grantee}-${category}`;
    let history = this.state.consentHistory.get(key) || [];
    if (history.length >= this.MAX_HISTORY_ENTRIES) {
      history = history.slice(1);
    }
    history.push({ block: this.currentBlockHeight, action, details });
    this.state.consentHistory.set(key, history);
  }

  // Private: Is authorized
  private isAuthorized(granter: string, caller: string): boolean {
    if (granter === caller) return true;
    const delegates = this.state.delegatedManagers.get(granter) || [];
    return delegates.includes(caller);
  }

  // Public: Grant consent
  grantConsent(caller: string, grantee: string, category: string, duration: number, notes?: string): ClarityResponse<boolean> {
    const granter = caller;
    this.initializeCategories();
    if (!this.state.validCategories.get(category)) return { ok: false, value: this.ERR_INVALID_CATEGORY };
    if (duration <= 0) return { ok: false, value: this.ERR_INVALID_DURATION };
    const key = `${granter}-${grantee}-${category}`;
    if (this.state.consents.has(key)) return { ok: false, value: this.ERR_ALREADY_GRANTED };
    const expiry = this.currentBlockHeight + duration;
    this.state.consents.set(key, { expiry, active: true });
    this.addToHistory(granter, grantee, category, "consent-granted", notes || "");
    return { ok: true, value: true };
  }

  // Public: Revoke consent
  revokeConsent(caller: string, grantee: string, category: string): ClarityResponse<boolean> {
    const granter = caller;
    const key = `${granter}-${grantee}-${category}`;
    const consent = this.state.consents.get(key);
    if (!consent) return { ok: false, value: this.ERR_NOT_FOUND };
    if (!this.isAuthorized(granter, caller)) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.consents.set(key, { ...consent, active: false });
    this.addToHistory(granter, grantee, category, "consent-revoked", "");
    return { ok: true, value: true };
  }

  // Read-only: Check consent
  checkConsent(granter: string, grantee: string, category: string): ClarityResponse<boolean> {
    const key = `${granter}-${grantee}-${category}`;
    const consent = this.state.consents.get(key);
    if (!consent) return { ok: false, value: this.ERR_NOT_FOUND };
    if (!consent.active || this.currentBlockHeight > consent.expiry) return { ok: false, value: this.ERR_CONSENT_EXPIRED };
    return { ok: true, value: true };
  }

  // Read-only: Get consent details
  getConsentDetails(granter: string, grantee: string, category: string): ClarityResponse<ConsentRecord | undefined> {
    const key = `${granter}-${grantee}-${category}`;
    return { ok: true, value: this.state.consents.get(key) };
  }

  // Public: Add valid category
  addValidCategory(category: string): ClarityResponse<boolean> {
    this.initializeCategories();
    if (this.state.validCategories.has(category)) return { ok: false, value: this.ERR_ALREADY_GRANTED };
    this.state.validCategories.set(category, true);
    return { ok: true, value: true };
  }

  // Public: Delegate manager
  delegateManager(caller: string, delegatee: string): ClarityResponse<boolean> {
    const granter = caller;
    let delegates = this.state.delegatedManagers.get(granter) || [];
    if (delegates.length >= this.MAX_DELEGATES) return { ok: false, value: this.ERR_MAX_DELEGATES_REACHED };
    if (delegates.includes(delegatee)) return { ok: false, value: this.ERR_ALREADY_GRANTED };
    delegates.push(delegatee);
    this.state.delegatedManagers.set(granter, delegates);
    return { ok: true, value: true };
  }

  // Public: Revoke delegation
  revokeDelegation(caller: string, delegatee: string): ClarityResponse<boolean> {
    const granter = caller;
    let delegates = this.state.delegatedManagers.get(granter) || [];
    const index = delegates.indexOf(delegatee);
    if (index === -1) return { ok: false, value: this.ERR_NOT_FOUND };
    delegates.splice(index, 1);
    this.state.delegatedManagers.set(granter, delegates);
    return { ok: true, value: true };
  }

  // Public: Grant consent as delegate
  grantConsentAsDelegate(caller: string, granter: string, grantee: string, category: string, duration: number, notes?: string): ClarityResponse<boolean> {
    if (!this.isAuthorized(granter, caller)) return { ok: false, value: this.ERR_NOT_DELEGATED };
    return this.grantConsent(granter, grantee, category, duration, notes ? `${notes} (by delegate ${caller})` : `(by delegate ${caller})`);
  }

  // Public: Renew consent
  renewConsent(caller: string, grantee: string, category: string, additionalDuration: number): ClarityResponse<boolean> {
    const granter = caller;
    const key = `${granter}-${grantee}-${category}`;
    const consent = this.state.consents.get(key);
    if (!consent || !consent.active) return { ok: false, value: this.ERR_NOT_FOUND };
    if (this.currentBlockHeight > consent.expiry) return { ok: false, value: this.ERR_CONSENT_EXPIRED };
    if (additionalDuration <= 0) return { ok: false, value: this.ERR_INVALID_DURATION };
    if (!this.isAuthorized(granter, caller)) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    const newExpiry = consent.expiry + additionalDuration;
    this.state.consents.set(key, { expiry: newExpiry, active: true });
    this.addToHistory(granter, grantee, category, "consent-renewed", additionalDuration.toString());
    return { ok: true, value: true };
  }

  // Read-only: Get consent history
  getConsentHistory(granter: string, grantee: string, category: string): ClarityResponse<HistoryEntry[]> {
    const key = `${granter}-${grantee}-${category}`;
    return { ok: true, value: this.state.consentHistory.get(key) || [] };
  }

  // Public: Create consent template
  createConsentTemplate(caller: string, templateName: string, categories: string[], duration: number, description: string): ClarityResponse<boolean> {
    if (this.state.consentTemplates.has(templateName)) return { ok: false, value: this.ERR_ALREADY_GRANTED };
    if (duration <= 0) return { ok: false, value: this.ERR_INVALID_DURATION };
    if (categories.length > this.MAX_CATEGORIES_PER_TEMPLATE) return { ok: false, value: this.ERR_INVALID_TEMPLATE };
    for (const cat of categories) {
      if (!this.state.validCategories.get(cat)) return { ok: false, value: this.ERR_INVALID_CATEGORY };
    }
    this.state.consentTemplates.set(templateName, { categories, duration, description });
    return { ok: true, value: true };
  }

  // Public: Grant consent with template
  grantConsentWithTemplate(caller: string, grantee: string, templateName: string): ClarityResponse<boolean> {
    const granter = caller;
    const template = this.state.consentTemplates.get(templateName);
    if (!template) return { ok: false, value: this.ERR_TEMPLATE_NOT_FOUND };
    for (const category of template.categories) {
      const result = this.grantConsent(granter, grantee, category, template.duration, template.description);
      if (!result.ok) return result;
    }
    return { ok: true, value: true };
  }

  // Read-only: Get consent template
  getConsentTemplate(templateName: string): ClarityResponse<TemplateRecord | undefined> {
    return { ok: true, value: this.state.consentTemplates.get(templateName) };
  }

  // Public: Batch grant consent
  batchGrantConsent(caller: string, grantee: string, categories: string[], duration: number): ClarityResponse<boolean> {
    for (const category of categories) {
      const result = this.grantConsent(caller, grantee, category, duration);
      if (!result.ok) return result;
    }
    return { ok: true, value: true };
  }

  // Public: Batch revoke consent
  batchRevokeConsent(caller: string, grantee: string, categories: string[]): ClarityResponse<boolean> {
    for (const category of categories) {
      const result = this.revokeConsent(caller, grantee, category);
      if (!result.ok) return result;
    }
    return { ok: true, value: true };
  }

  // Read-only: Is valid category
  isValidCategory(category: string): ClarityResponse<boolean> {
    return { ok: true, value: !!this.state.validCategories.get(category) };
  }

  // Read-only: Get delegates
  getDelegates(granter: string): ClarityResponse<string[]> {
    return { ok: true, value: this.state.delegatedManagers.get(granter) || [] };
  }
}

// Test accounts
const accounts = {
  user1: "user1",
  user2: "user2",
  user3: "user3",
  user4: "user4",
};

// Tests
describe("ConsentManagerMock", () => {
  let contract: ConsentManagerMock;

  beforeEach(() => {
    contract = new ConsentManagerMock();
  });

  it("initializes categories on first call", () => {
    expect(contract.state.initialized).toBe(false);
    contract.grantConsent(accounts.user1, accounts.user2, "medical-history", 1000);
    expect(contract.state.initialized).toBe(true);
    expect(contract.state.validCategories.get("medical-history")).toBe(true);
  });

  it("grants and checks consent successfully", () => {
    const grant = contract.grantConsent(accounts.user1, accounts.user2, "vaccinations", 500);
    expect(grant.ok).toBe(true);
    const check = contract.checkConsent(accounts.user1, accounts.user2, "vaccinations");
    expect(check.ok).toBe(true);
    expect(check.value).toBe(true);
  });

  it("rejects invalid category", () => {
    const grant = contract.grantConsent(accounts.user1, accounts.user2, "invalid", 500);
    expect(grant.ok).toBe(false);
    expect(grant.value).toBe(102);
  });

  it("revokes consent", () => {
    contract.grantConsent(accounts.user1, accounts.user2, "allergies", 500);
    const revoke = contract.revokeConsent(accounts.user1, accounts.user2, "allergies");
    expect(revoke.ok).toBe(true);
    const check = contract.checkConsent(accounts.user1, accounts.user2, "allergies");
    expect(check.ok).toBe(false);
    expect(check.value).toBe(101);
  });

  it("expires consent after blocks advance", () => {
    contract.grantConsent(accounts.user1, accounts.user2, "medications", 100);
    contract.advanceBlock(101);
    const check = contract.checkConsent(accounts.user1, accounts.user2, "medications");
    expect(check.ok).toBe(false);
    expect(check.value).toBe(101);
  });

  it("adds and uses new category", () => {
    const add = contract.addValidCategory("new-cat");
    expect(add.ok).toBe(true);
    const grant = contract.grantConsent(accounts.user1, accounts.user2, "new-cat", 500);
    expect(grant.ok).toBe(true);
  });

  it("delegates and grants as delegate", () => {
    contract.delegateManager(accounts.user1, accounts.user3);
    const grantAsDelegate = contract.grantConsentAsDelegate(accounts.user3, accounts.user1, accounts.user2, "lab-results", 500);
    expect(grantAsDelegate.ok).toBe(true);
    const check = contract.checkConsent(accounts.user1, accounts.user2, "lab-results");
    expect(check.ok).toBe(true);
    expect(check.value).toBe(true);
  });

  it("rejects grant as non-delegate", () => {
    const grantAsDelegate = contract.grantConsentAsDelegate(accounts.user3, accounts.user1, accounts.user2, "lab-results", 500);
    expect(grantAsDelegate.ok).toBe(false);
    expect(grantAsDelegate.value).toBe(105);
  });

  it("renews consent", () => {
    contract.grantConsent(accounts.user1, accounts.user2, "mental-health", 100);
    contract.advanceBlock(50);
    const renew = contract.renewConsent(accounts.user1, accounts.user2, "mental-health", 100);
    expect(renew.ok).toBe(true);
    contract.advanceBlock(51);
    const check = contract.checkConsent(accounts.user1, accounts.user2, "mental-health");
    expect(check.ok).toBe(true);
    expect(check.value).toBe(true);
  });

  it("tracks history", () => {
    contract.grantConsent(accounts.user1, accounts.user2, "imaging", 500, "initial grant");
    contract.renewConsent(accounts.user1, accounts.user2, "imaging", 200);
    contract.revokeConsent(accounts.user1, accounts.user2, "imaging");
    const history = contract.getConsentHistory(accounts.user1, accounts.user2, "imaging");
    expect(history.value.length).toBe(3);
    expect(history.value[0].action).toBe("consent-granted");
    expect(history.value[1].action).toBe("consent-renewed");
    expect(history.value[2].action).toBe("consent-revoked");
  });

  it("batch grants consents", () => {
    const batch = contract.batchGrantConsent(accounts.user1, accounts.user2, ["genetics", "imaging"], 500);
    expect(batch.ok).toBe(true);
    const check1 = contract.checkConsent(accounts.user1, accounts.user2, "genetics");
    expect(check1.value).toBe(true);
    const check2 = contract.checkConsent(accounts.user1, accounts.user2, "imaging");
    expect(check2.value).toBe(true);
  });

  it("batch revokes consents", () => {
    contract.batchGrantConsent(accounts.user1, accounts.user2, ["genetics", "imaging"], 500);
    const batch = contract.batchRevokeConsent(accounts.user1, accounts.user2, ["genetics", "imaging"]);
    expect(batch.ok).toBe(true);
    const check1 = contract.checkConsent(accounts.user1, accounts.user2, "genetics");
    expect(check1.ok).toBe(false);
    const check2 = contract.checkConsent(accounts.user1, accounts.user2, "imaging");
    expect(check2.ok).toBe(false);
  });

  it("gets delegates", () => {
    contract.delegateManager(accounts.user1, accounts.user3);
    contract.delegateManager(accounts.user1, accounts.user4);
    const delegates = contract.getDelegates(accounts.user1);
    expect(delegates.value).toEqual([accounts.user3, accounts.user4]);
  });

  it("revokes delegation", () => {
    contract.delegateManager(accounts.user1, accounts.user3);
    const revoke = contract.revokeDelegation(accounts.user1, accounts.user3);
    expect(revoke.ok).toBe(true);
    const delegates = contract.getDelegates(accounts.user1);
    expect(delegates.value).toEqual([]);
  });

  it("prevents exceeding max delegates", () => {
    for (let i = 0; i < 10; i++) {
      contract.delegateManager(accounts.user1, `delegate${i}`);
    }
    const addExtra = contract.delegateManager(accounts.user1, "extra");
    expect(addExtra.ok).toBe(false);
    expect(addExtra.value).toBe(109);
  });

  it("handles history overflow", () => {
    contract.grantConsent(accounts.user1, accounts.user2, "medical-history", 500);
    for (let i = 0; i < 60; i++) {
      contract.renewConsent(accounts.user1, accounts.user2, "medical-history", 1);
      contract.advanceBlock(1);
    }
    const history = contract.getConsentHistory(accounts.user1, accounts.user2, "medical-history");
    expect(history.value.length).toBe(50);
  });
});