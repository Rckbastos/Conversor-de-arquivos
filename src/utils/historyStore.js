const DB_NAME = 'archlight_local_db'
const DB_VERSION = 1
const STORE_RESULTS = 'results'

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Falha no IndexedDB'))
  })

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'))
    tx.onerror = () => reject(tx.error || new Error('Falha na transação'))
  })

export const isIndexedDbAvailable = () => typeof indexedDB !== 'undefined'

const openDb = async () => {
  const req = indexedDB.open(DB_NAME, DB_VERSION)
  req.onupgradeneeded = () => {
    const db = req.result
    if (!db.objectStoreNames.contains(STORE_RESULTS)) {
      const store = db.createObjectStore(STORE_RESULTS, { keyPath: 'id' })
      store.createIndex('at', 'at', { unique: false })
      store.createIndex('sessionId', 'sessionId', { unique: false })
    }
  }
  return requestToPromise(req)
}

export const putConvertedResult = async (entry) => {
  if (!isIndexedDbAvailable()) return false
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_RESULTS, 'readwrite')
    tx.objectStore(STORE_RESULTS).put(entry)
    await txDone(tx)
    return true
  } finally {
    db.close()
  }
}

export const getConvertedResult = async (id) => {
  if (!isIndexedDbAvailable()) return null
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_RESULTS, 'readonly')
    const result = await requestToPromise(tx.objectStore(STORE_RESULTS).get(id))
    await txDone(tx)
    return result || null
  } finally {
    db.close()
  }
}

export const purgeOldResults = async (ttlMs) => {
  if (!isIndexedDbAvailable()) return 0
  const now = Date.now()
  const db = await openDb()
  let removed = 0
  try {
    const tx = db.transaction(STORE_RESULTS, 'readwrite')
    const store = tx.objectStore(STORE_RESULTS)
    const index = store.index('at')

    await new Promise((resolve, reject) => {
      const req = index.openCursor()
      req.onerror = () => reject(req.error || new Error('Falha no cursor'))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const value = cursor.value
        if (typeof value?.at === 'number' && now - value.at > ttlMs) {
          store.delete(cursor.primaryKey)
          removed += 1
          cursor.continue()
          return
        }
        // Como o índice está em ordem crescente, ao encontrar um item dentro do TTL, podemos parar.
        resolve()
      }
    })

    await txDone(tx)
    return removed
  } finally {
    db.close()
  }
}

export const deleteResultsForSession = async (sessionId) => {
  if (!isIndexedDbAvailable()) return 0
  const db = await openDb()
  let removed = 0
  try {
    const tx = db.transaction(STORE_RESULTS, 'readwrite')
    const store = tx.objectStore(STORE_RESULTS)
    const index = store.index('sessionId')

    await new Promise((resolve, reject) => {
      const range = IDBKeyRange.only(sessionId)
      const req = index.openCursor(range)
      req.onerror = () => reject(req.error || new Error('Falha no cursor'))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        store.delete(cursor.primaryKey)
        removed += 1
        cursor.continue()
      }
    })

    await txDone(tx)
    return removed
  } finally {
    db.close()
  }
}

