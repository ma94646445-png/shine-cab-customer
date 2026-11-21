import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebaseApp';

function mapUser(u: any) {
  if (!u) return null;
  return {
    id: u.uid,
    email: u.email || `${u.uid.slice(0, 6)}@shinecab.app`,
    phone: u.phoneNumber || '',
    user_metadata: { full_name: u.displayName || 'Shine Rider' },
  };
}

class FirestoreQueryBuilder {
  private table: string;
  private filters: Array<{ field: string; value: any }> = [];
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: any = null;
  private isSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(_cols = '*') {
    if (this.op !== 'insert' && this.op !== 'upsert' && this.op !== 'update') {
      this.op = 'select';
    }
    return this;
  }

  insert(data: any) {
    this.op = 'insert';
    this.payload = data;
    return this;
  }

  upsert(data: any, _opts?: any) {
    this.op = 'upsert';
    this.payload = data;
    return this;
  }

  update(data: any) {
    this.op = 'update';
    this.payload = data;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push({ field, value });
    return this;
  }

  in(field: string, values: any[]) {
    if (values && values.length > 0) {
      this.filters.push({ field, value: values[0] });
    }
    return this;
  }

  order(_field: string, _opts?: any) {
    return this;
  }

  limit(_n: number) {
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    return this.execute();
  }

  single() {
    this.isSingle = true;
    return this.execute();
  }

  then(resolve: any, reject?: any) {
    return this.execute().then(resolve, reject);
  }

  private async execute(): Promise<{ data: any; error: any }> {
    try {
      const colRef = collection(db, this.table);

      if (this.op === 'insert' || this.op === 'upsert') {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const saved: any[] = [];
        for (const item of items) {
          const docId = item.id || item.user_id || doc(colRef).id;
          const record = {
            ...item,
            id: docId,
            created_at: item.created_at || new Date().toISOString(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, this.table, docId), record, { merge: true });
          saved.push(record);
        }
        return { data: this.isSingle ? saved[0] : saved, error: null };
      }

      if (this.op === 'update') {
        const idFilter = this.filters.find((f) => f.field === 'id');
        if (idFilter) {
          await updateDoc(doc(db, this.table, idFilter.value), {
            ...this.payload,
            updatedAt: serverTimestamp(),
          });
          return { data: { id: idFilter.value, ...this.payload }, error: null };
        }
        const snap = await getDocs(colRef);
        for (const d of snap.docs) {
          const data = d.data();
          const match = this.filters.every((f) => data[f.field] === f.value);
          if (match) {
            await updateDoc(d.ref, { ...this.payload, updatedAt: serverTimestamp() });
          }
        }
        return { data: this.payload, error: null };
      }

      if (this.op === 'delete') {
        const idFilter = this.filters.find((f) => f.field === 'id');
        if (idFilter) {
          await deleteDoc(doc(db, this.table, idFilter.value));
        }
        return { data: null, error: null };
      }

      const idFilter = this.filters.find((f) => f.field === 'id');
      if (idFilter) {
        const dSnap = await getDoc(doc(db, this.table, idFilter.value));
        const row = dSnap.exists() ? { id: dSnap.id, ...dSnap.data() } : null;
        return { data: this.isSingle ? row : row ? [row] : [], error: null };
      }

      const qConstraints = this.filters.map((f) => where(f.field, '==', f.value));
      const q = qConstraints.length > 0 ? query(colRef, ...qConstraints) : colRef;
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return { data: this.isSingle ? rows[0] || null : rows, error: null };
    } catch (error: any) {
      return { data: this.isSingle ? null : [], error };
    }
  }
}

export function getSupabaseClient(_url?: string, _key?: string): any {
  const channels: Record<string, () => void> = {};

  return {
    from: (table: string) => new FirestoreQueryBuilder(table),
    auth: {
      async getSession() {
        await auth.authStateReady();
        const user = mapUser(auth.currentUser);
        return {
          data: {
            session: user ? { user, access_token: 'firebase-token' } : null,
          },
          error: null,
        };
      },
      onAuthStateChange(cb: (event: string, session: any) => void) {
        const unsub = onAuthStateChanged(auth, (fbUser) => {
          const user = mapUser(fbUser);
          cb(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? { user, access_token: 'firebase-token' } : null);
        });
        return { data: { subscription: { unsubscribe: unsub } } };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        try {
          const res = await signInWithEmailAndPassword(auth, email, password);
          const user = mapUser(res.user);
          return { data: { user, session: { user } }, error: null };
        } catch (err: any) {
          return { data: { user: null, session: null }, error: err };
        }
      },
      async signUp({ email, password }: { email: string; password: string }) {
        try {
          const res = await createUserWithEmailAndPassword(auth, email, password);
          const user = mapUser(res.user);
          return { data: { user, session: { user } }, error: null };
        } catch (err: any) {
          return { data: { user: null, session: null }, error: err };
        }
      },
      async signInWithOtp({ phone }: { phone: string }) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        localStorage.setItem("shinecab_pending_otp_" + phone, code);
        setTimeout(() => alert("SHINE CAB Verification OTP for " + phone + ": " + code), 200);
        return { data: { user: null, session: null }, error: null };
      },
      async verifyOtp({ phone, token }: { phone: string; token: string }) {
        const expected = localStorage.getItem("shinecab_pending_otp_" + phone);
        if (!expected || String(token).trim() !== expected) {
          return { data: { user: null, session: null }, error: { message: "Invalid OTP. Please enter the 6-digit code sent to your number." } };
        }
        localStorage.removeItem("shinecab_pending_otp_" + phone);
        const res = await signInAnonymously(auth);
        const user = mapUser(res.user);
        if (user) {
          user.phone = phone;
          const cleanPhone = String(phone).replace(/\D/g, "").slice(-4) || String(Math.floor(1000 + Math.random() * 9000));
          const savedName = (localStorage.getItem("shinecab_user_name_" + phone) || "Customer").trim();
          const initials = savedName.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase().padEnd(2, "X");
          const smartId = cleanPhone + "-" + initials;
          user.id = smartId;
          setDoc(doc(db, "users", smartId), {
            id: smartId,
            short_id: smartId,
            full_name: savedName,
            phone: phone,
            role: "customer",
            status: "active",
            created_at: new Date().toISOString()
          }, { merge: true }).catch(() => {});
        }
        return { data: { user, session: { user } }, error: null };
      },
      async signOut() {
        await signOut(auth);
        return { error: null };
      },
    },
    channel(name: string) {
      let tableName = 'rides';
      let callback: any = null;
      return {
        on(_type: string, filter: any, cb: any) {
          if (filter?.table) tableName = filter.table;
          callback = cb;
          return this;
        },
        subscribe() {
          const unsub = onSnapshot(collection(db, tableName), (snap) => {
            snap.docChanges().forEach((change) => {
              if (callback) {
                callback({
                  eventType: change.type === 'added' ? 'INSERT' : 'UPDATE',
                  new: { id: change.doc.id, ...change.doc.data() },
                });
              }
            });
          });
          channels[name] = unsub;
          return { name };
        },
      };
    },
    removeChannel(ch: any) {
      if (ch?.name && channels[ch.name]) {
        channels[ch.name]();
        delete channels[ch.name];
      }
    },
  };
}
