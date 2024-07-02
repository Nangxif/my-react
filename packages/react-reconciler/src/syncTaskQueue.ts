let syncQueue: ((...args: any) => void)[] | null = null;
// 当前是否正在执行同步的回调函数
let isFlushingSyncQueue = false;

export function scheduleSyncCallback(callback: (...args: any) => void) {
	if (syncQueue === null) {
		// 第一个回调函数
		syncQueue = [callback];
	} else {
		syncQueue.push(callback);
	}
}

// 执行同步的回调函数
export function flushSyncCallbacks() {
	console.log('进来了')
	if (!isFlushingSyncQueue && syncQueue) {
		isFlushingSyncQueue = true;
		try {
			syncQueue.forEach((callback) => callback());
		} catch (e) {
			console.error('flushSyncCallbacks报错', e);
		} finally {
			isFlushingSyncQueue = false;
			syncQueue = null;
		}
	}
}
