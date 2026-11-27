import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { AuthProviderType, PlayerLocation, UserProfile } from '../game/types.ts';
import {
  evaluatePlayerProximity,
  isRealRegisteredPlayer,
  sanitizePlayerLocation,
  sortPlayersByProximity,
} from '../game/location.ts';
import { formatPlayerId, matchesPlayerIdQuery, stripPlayerId } from '../game/playerId.ts';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';

export interface FirestoreFriendPlayer {
  uid: string;
  playerId: string;
  username: string;
  authProvider?: AuthProviderType;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints?: number;
  online: boolean;
  location?: PlayerLocation;
  distanceKm?: number | null;
  sameRegion?: boolean;
  locationLabel?: string;
}

export interface FirestoreFriendEntry {
  friendshipId: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  player: FirestoreFriendPlayer;
}

function toFriendPlayer(
  uid: string,
  p: Partial<UserProfile>,
  selfLocation?: PlayerLocation,
): FirestoreFriendPlayer {
  const location = sanitizePlayerLocation(p.location);
  const base: FirestoreFriendPlayer = {
    uid,
    playerId: formatPlayerId(p.playerId || ''),
    username: p.username || 'Player',
    authProvider: p.authProvider,
    avatar: p.avatar || 'avatar_ace',
    customAvatarUrl: typeof p.customAvatarUrl === 'string' ? p.customAvatarUrl : '',
    frame: p.frame || 'frame_bronze',
    level: typeof p.level === 'number' ? p.level : 1,
    rating: typeof p.rating === 'number' ? p.rating : 1000,
    rankPoints: typeof p.rankPoints === 'number' ? p.rankPoints : 0,
    online: false,
    location,
  };
  return evaluatePlayerProximity(base, selfLocation);
}

export async function fetchFirestoreRecommendedPlayers(
  currentUid: string,
  searchQuery: string = '',
  selfLocation?: PlayerLocation,
): Promise<FirestoreFriendPlayer[]> {
  if (!auth.currentUser) return [];
  const path = 'users';
  const trimmedQuery = searchQuery.trim();
  const qLower = trimmedQuery.toLowerCase();
  const digits = stripPlayerId(trimmedQuery);

  try {
    const list: FirestoreFriendPlayer[] = [];
    const seen = new Set<string>();

    // Exact 9-digit Player ID lookup (works globally regardless of list cap)
    if (digits.length === 9 && !/[a-zA-Z]/.test(trimmedQuery)) {
      const formattedExact = formatPlayerId(digits);
      const exactSnap = await getDocs(
        query(collection(db, 'users'), where('playerId', '==', formattedExact), limit(5)),
      );
      for (const d of exactSnap.docs) {
        if (d.id === currentUid || seen.has(d.id)) continue;
        const data = d.data() as Partial<UserProfile>;
        if (!isRealRegisteredPlayer({ ...data, uid: d.id })) continue;
        seen.add(d.id);
        list.push(toFriendPlayer(d.id, data, selfLocation));
      }
    }

    const snap = await getDocs(query(collection(db, 'users'), orderBy('updatedAt', 'desc'), limit(60)));
    for (const d of snap.docs) {
      if (d.id === currentUid || seen.has(d.id)) continue;
      const data = d.data() as Partial<UserProfile>;
      if (!data.username) continue;
      if (!isRealRegisteredPlayer({ ...data, uid: d.id })) continue;
      const p = toFriendPlayer(d.id, data, selfLocation);
      if (
        !trimmedQuery ||
        p.username.toLowerCase().includes(qLower) ||
        matchesPlayerIdQuery(p.playerId, trimmedQuery)
      ) {
        seen.add(d.id);
        list.push(p);
      }
      if (list.length >= 30) break;
    }
    return sortPlayersByProximity(list);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchFirestoreFriends(currentUid: string): Promise<FirestoreFriendEntry[]> {
  if (!auth.currentUser) return [];
  const path = 'friends';

  try {
    const [outSnap, inSnap] = await Promise.all([
      getDocs(query(collection(db, 'friends'), where('userId', '==', currentUid), limit(50))),
      getDocs(query(collection(db, 'friends'), where('friendId', '==', currentUid), limit(50))),
    ]);

    const seen = new Set<string>();
    const rawEntries: Array<{
      friendshipId: string;
      status: 'pending' | 'accepted';
      direction: 'incoming' | 'outgoing';
      otherUid: string;
    }> = [];

    for (const d of outSnap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as { userId: string; friendId: string; status: 'pending' | 'accepted' };
      rawEntries.push({
        friendshipId: d.id,
        status: data.status,
        direction: 'outgoing',
        otherUid: data.friendId,
      });
    }

    for (const d of inSnap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as { userId: string; friendId: string; status: 'pending' | 'accepted' };
      rawEntries.push({
        friendshipId: d.id,
        status: data.status,
        direction: 'incoming',
        otherUid: data.userId,
      });
    }

    const entries = await Promise.all(
      rawEntries.map(async (item): Promise<FirestoreFriendEntry> => {
        try {
          const userSnap = await getDoc(doc(db, 'users', item.otherUid));
          const playerData = userSnap.exists() ? (userSnap.data() as Partial<UserProfile>) : {};
          return {
            friendshipId: item.friendshipId,
            status: item.status,
            direction: item.direction,
            player: toFriendPlayer(item.otherUid, playerData),
          };
        } catch {
          return {
            friendshipId: item.friendshipId,
            status: item.status,
            direction: item.direction,
            player: toFriendPlayer(item.otherUid, {}),
          };
        }
      }),
    );

    return entries;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function sendFirestoreFriendRequest(
  currentUid: string,
  targetUid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user || user.uid !== currentUid) {
    return { ok: false, error: 'Sign in with Google to add cross device friends.' };
  }
  if (!targetUid || targetUid === currentUid) {
    return { ok: false, error: 'Invalid friend target.' };
  }

  const pair = [currentUid, targetUid].sort().join('_');
  const friendshipId = `fr_${pair.slice(0, 120)}`;
  const path = `friends/${friendshipId}`;

  try {
    const existing = await getDoc(doc(db, 'friends', friendshipId));
    if (existing.exists()) {
      const st = (existing.data() as { status?: string }).status;
      return {
        ok: false,
        error: st === 'accepted' ? 'Already friends!' : 'Friend request already pending.',
      };
    }

    const now = new Date().toISOString();
    await setDoc(doc(db, 'friends', friendshipId), {
      userId: currentUid,
      friendId: targetUid,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function respondFirestoreFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<void> {
  if (!auth.currentUser) return;
  const path = `friends/${friendshipId}`;
  try {
    if (accept) {
      await updateDoc(doc(db, 'friends', friendshipId), {
        status: 'accepted',
        updatedAt: new Date().toISOString(),
      });
    } else {
      await deleteDoc(doc(db, 'friends', friendshipId));
    }
  } catch (error) {
    handleFirestoreError(error, accept ? OperationType.UPDATE : OperationType.DELETE, path);
  }
}

export async function removeFirestoreFriendship(friendshipId: string): Promise<void> {
  if (!auth.currentUser) return;
  const path = `friends/${friendshipId}`;
  try {
    await deleteDoc(doc(db, 'friends', friendshipId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
