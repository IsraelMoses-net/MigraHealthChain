// tests/HealthDataVault.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buff, stringAscii, uint, Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_DATA_NOT_FOUND = 101;
const ERR_CATEGORY_EMPTY = 102;
const ERR_HASH_INVALID = 103;
const ERR_ALREADY_EXISTS = 104;
const ERR_VERIFY_FAILED = 105;
const ERR_UPDATE_DENIED = 106;
const ERR_CATEGORY_LIMIT = 107;

const MAX_CATEGORIES = 20;
const HASH_SIZE = 32;

interface DataRecord {
  hash: Uint8Array;
  "uploaded-at": bigint;
  version: bigint;
}

interface HealthDataVaultState {
  "contract-owner": string;
  "user-data-hashes": Map<string, DataRecord>;
  "category-index": Map<string, string[]>;
}

class HealthDataVaultMock {
  state: HealthDataVaultState;
  blockHeight: bigint;
  caller: string;
  contractOwner: string;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      "contract-owner": "ST1OWNER",
      "user-data-hashes": new Map(),
      "category-index": new Map(),
    };
    this.blockHeight = 100n;
    this.caller = "ST1OWNER";
    this.contractOwner = "ST1OWNER";
  }

  private getMapKey(owner: string, category: string): string {
    return `${owner}::${category}`;
  }

  private validateCategory(category: string): { ok: true } | { ok: false; value: number } {
    if (category.length > 0 && category.length <= 32) return { ok: true };
    return { ok: false, value: ERR_CATEGORY_EMPTY };
  }

  private validateHash(hash: Uint8Array): { ok: true } | { ok: false; value: number } {
    if (hash.length === HASH_SIZE) return { ok: true };
    return { ok: false, value: ERR_HASH_INVALID };
  }

  private getCategories(owner: string): string[] {
    return this.state["category-index"].get(owner) || [];
  }

  private updateCategoryList(owner: string, category: string): { ok: string[] } | { ok: false; value: number } {
    const current = this.getCategories(owner);
    if (current.includes(category)) return { ok: current };
    const updated = [...current, category];
    if (updated.length > MAX_CATEGORIES) return { ok: false, value: ERR_CATEGORY_LIMIT };
    this.state["category-index"].set(owner, updated);
    return { ok: updated };
  }

  "get-data-hash"(owner: string, category: string): { ok: DataRecord | null } {
    const key = this.getMapKey(owner, category);
    const record = this.state["user-data-hashes"].get(key);
    return { ok: record || null };
  }

  "get-user-categories"(owner: string): { ok: string[] } {
    return { ok: this.getCategories(owner) };
  }

  "verify-data-hash"(owner: string, category: string, providedData: Uint8Array): { ok: boolean } | { ok: false; value: number } {
    const key = this.getMapKey(owner, category);
    const record = this.state["user-data-hashes"].get(key);
    if (!record) return { ok: false, value: ERR_DATA_NOT_FOUND };
    const computed = Cl.hash160(providedData);
    return computed.equals(record.hash) ? { ok: true } : { ok: false, value: ERR_VERIFY_FAILED };
  }

  "is-category-used"(owner: string, category: string): { ok: boolean } {
    return { ok: this.state["user-data-hashes"].has(this.getMapKey(owner, category)) };
  }

  "upload-data"(category: string, dataHash: Uint8Array): { ok: boolean } | { ok: false; value: number } {
    const validation = this.validateCategory(category);
    if (!validation.ok) return validation;
    const hashValidation = this.validateHash(dataHash);
    if (!hashValidation.ok) return hashValidation;
    const key = this.getMapKey(this.caller, category);
    if (this.state["user-data-hashes"].has(key)) return { ok: false, value: ERR_ALREADY_EXISTS };
    this.state["user-data-hashes"].set(key, {
      hash: dataHash,
      "uploaded-at": this.blockHeight,
      version: 1n,
    });
    const listResult = this.updateCategoryList(this.caller, category);
    if (!listResult.ok) return listResult;
    return { ok: true };
  }

  "update-data"(category: string, newHash: Uint8Array): { ok: boolean } | { ok: false; value: number } {
    const key = this.getMapKey(this.caller, category);
    const existing = this.state["user-data-hashes"].get(key);
    if (!existing) return { ok: false, value: ERR_DATA_NOT_FOUND };
    const hashValidation = this.validateHash(newHash);
    if (!hashValidation.ok) return hashValidation;
    this.state["user-data-hashes"].set(key, {
      hash: newHash,
      "uploaded-at": existing["uploaded-at"],
      version: existing.version + 1n,
    });
    return { ok: true };
  }

  "delete-data"(category: string): { ok: boolean } | { ok: false; value: number } {
    const key = this.getMapKey(this.caller, category);
    const existing = this.state["user-data-hashes"].get(key);
    if (!existing) return { ok: false, value: ERR_DATA_NOT_FOUND };
    this.state["user-data-hashes"].delete(key);
    const current = this.getCategories(this.caller);
    const filtered = current.filter(c => c !== category);
    this.state["category-index"].set(this.caller, filtered);
    return { ok: true };
  }

  "transfer-ownership"(newOwner: string): { ok: boolean } | { ok: false; value: number } {
    if (this.caller !== this.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.contractOwner = newOwner;
    this.state["contract-owner"] = newOwner;
    return { ok: true };
  }

  "get-contract-owner"(): { ok: string } {
    return { ok: this.contractOwner };
  }

  "get-data-version"(owner: string, category: string): { ok: bigint } | { ok: false; value: number } {
    const key = this.getMapKey(owner, category);
    const record = this.state["user-data-hashes"].get(key);
    return record ? { ok: record.version } : { ok: false, value: ERR_DATA_NOT_FOUND };
  }

  "get-upload-timestamp"(owner: string, category: string): { ok: bigint } | { ok: false; value: number } {
    const key = this.getMapKey(owner, category);
    const record = this.state["user-data-hashes"].get(key);
    return record ? { ok: record["uploaded-at"] } : { ok: false, value: ERR_DATA_NOT_FOUND };
  }
}

describe("HealthDataVault", () => {
  let vault: HealthDataVaultMock;

  beforeEach(() => {
    vault = new HealthDataVaultMock();
    vault.reset();
    vault.caller = "ST1USER";
  });

  it("uploads data successfully with valid inputs", () => {
    const category = "vaccination";
    const hash = new Uint8Array(32).fill(1);
    const result = vault["upload-data"](category, hash);
    expect(result.ok).toBe(true);
    const stored = vault["get-data-hash"]("ST1USER", category);
    expect(stored.ok?.hash).toEqual(hash);
    expect(stored.ok?.version).toBe(1n);
    expect(stored.ok?.["uploaded-at"]).toBe(100n);
  });

  it("rejects upload with empty category", () => {
    const hash = new Uint8Array(32).fill(1);
    const result = vault["upload-data"]("", hash);
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_CATEGORY_EMPTY);
  });

  it("rejects upload with category too long", () => {
    const longCat = "a".repeat(33);
    const hash = new Uint8Array(32).fill(1);
    const result = vault["upload-data"](longCat, hash);
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_CATEGORY_EMPTY);
  });

  it("rejects upload with invalid hash size", () => {
    const category = "test";
    const invalidHash = new Uint8Array(31);
    const result = vault["upload-data"](category, invalidHash);
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_HASH_INVALID);
  });

  it("prevents duplicate category upload", () => {
    const category = "immunization";
    const hash1 = new Uint8Array(32).fill(2);
    vault["upload-data"](category, hash1);
    const hash2 = new Uint8Array(32).fill(3);
    const result = vault["upload-data"](category, hash2);
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_ALREADY_EXISTS);
  });

  it("updates existing data and increments version", () => {
    const category = "blood-test";
    const hash1 = new Uint8Array(32).fill(4);
    const hash2 = new Uint8Array(32).fill(5);
    vault["upload-data"](category, hash1);
    const update = vault["update-data"](category, hash2);
    expect(update.ok).toBe(true);
    const record = vault["get-data-hash"]("ST1USER", category).ok!;
    expect(record.hash).toEqual(hash2);
    expect(record.version).toBe(2n);
  });

  it("rejects update on non-existent data", () => {
    const result = vault["update-data"]("nonexistent", new Uint8Array(32).fill(6));
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_DATA_NOT_FOUND);
  });

  it("deletes data and removes from category index", () => {
    const category = "xray";
    vault["upload-data"](category, new Uint8Array(32).fill(7));
    const del = vault["delete-data"](category);
    expect(del.ok).toBe(true);
    const check = vault["get-data-hash"]("ST1USER", category);
    expect(check.ok).toBeNull();
    const categories = vault["get-user-categories"]("ST1USER").ok;
    expect(categories).not.toContain(category);
  });

  it("tracks multiple categories per user", () => {
    const cats = ["vital", "lab", "scan", "note"];
    cats.forEach((c, i) => {
      vault["upload-data"](c, new Uint8Array(32).fill(i + 10));
    });
    const list = vault["get-user-categories"]("ST1USER").ok;
    expect(list).toEqual(expect.arrayContaining(cats));
    expect(list.length).toBe(4);
  });

  it("enforces category limit per user", () => {
    for (let i = 0; i < MAX_CATEGORIES; i++) {
      vault["upload-data"](`cat-${i}`, new Uint8Array(32).fill(i));
    }
    const result = vault["upload-data"]("overflow", new Uint8Array(32).fill(99));
    expect(result.ok).toBe(false);
    expect((result as any).value).toBe(ERR_CATEGORY_LIMIT);
  });

  it("returns correct version and timestamp", () => {
    vault.blockHeight = 200n;
    const category = "surgery";
    const hash = new Uint8Array(32).fill(15);
    vault["upload-data"](category, hash);
    const version = vault["get-data-version"]("ST1USER", category);
    expect(version.ok).toBe(1n);
    const time = vault["get-upload-timestamp"]("ST1USER", category);
    expect(time.ok).toBe(200n);
    vault["update-data"](category, new Uint8Array(32).fill(16));
    const version2 = vault["get-data-version"]("ST1USER", category);
    expect(version2.ok).toBe(2n);
  });

  it("allows contract owner to transfer ownership", () => {
    vault.caller = "ST1OWNER";
    const transfer = vault["transfer-ownership"]("ST2NEW");
    expect(transfer.ok).toBe(true);
    const owner = vault["get-contract-owner"]();
    expect(owner.ok).toBe("ST2NEW");
  });

  it("blocks non-owner from transferring ownership", () => {
    vault.caller = "ST1HACKER";
    const transfer = vault["transfer-ownership"]("ST3EVIL");
    expect(transfer.ok).toBe(false);
    expect((transfer as any).value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("returns empty category list for new user", () => {
    const list = vault["get-user-categories"]("ST3UNKNOWN").ok;
    expect(list).toEqual([]);
  });

  it("handles concurrent category operations safely", () => {
    const user = "ST2MULTI";
    vault.caller = user;
    const cats = Array.from({ length: 10 }, (_, i) => `record-${i}`);
    cats.forEach((c, i) => {
      vault["upload-data"](c, new Uint8Array(32).fill(i));
    });
    const list = vault["get-user-categories"](user).ok;
    expect(list.length).toBe(10);
    vault["delete-data"]("record-5");
    const updated = vault["get-user-categories"](user).ok;
    expect(updated.length).toBe(9);
    expect(updated).not.toContain("record-5");
  });

  it("preserves category order in index", () => {
    const order = ["a", "b", "c", "d"];
    order.forEach((c, i) => {
      vault["upload-data"](c, new Uint8Array(32).fill(i + 20));
    });
    const list = vault["get-user-categories"]("ST1USER").ok;
    expect(list).toEqual(order);
  });

  it("rejects upload after ownership transfer by old owner", () => {
    vault.caller = "ST1OWNER";
    vault["transfer-ownership"]("ST2NEW");
    vault.caller = "ST1OWNER";
    const result = vault["upload-data"]("test", new Uint8Array(32).fill(1));
    expect(result.ok).toBe(true);
  });
});