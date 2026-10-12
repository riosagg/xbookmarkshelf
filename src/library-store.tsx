import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { db } from './db';

export const LibraryStore = createContext(db);
export function useLibraryDB() { return useContext(LibraryStore); }
