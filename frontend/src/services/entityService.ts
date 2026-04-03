import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export interface UserEntity {
  id: string;
  name: string;
  type: "business" | "rental";
}

export async function getUserEntities(userId: string): Promise<UserEntity[]> {
  const snap = await getDocs(
    query(collection(db, "entities"), where("userId", "==", userId))
  );
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    type: d.data().type as "business" | "rental",
  }));
}
