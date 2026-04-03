import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export const apiClient = {
  call: async <Res = unknown>(fn: string, data?: unknown): Promise<Res> => {
    const callable = httpsCallable<unknown, Res>(functions, fn);
    const result = await callable(data);
    return result.data;
  },
};
