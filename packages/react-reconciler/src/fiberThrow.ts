import { Wakeable } from 'shared/ReactTypes';
import { FiberRootNode } from './fiber';
import { Lane, markRootPinged } from './fiberLanes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';
import { getSuspeseHandler } from './suspenseContext';
import { ShouldCapture } from './fiberFlags';

export function throwException(root: FiberRootNode, value: any, lane: Lane) {
	if (
		value !== null &&
		typeof value === 'object' &&
		typeof value.then === 'function'
	) {
		// 这种情况下可以把他当成一个thenable
		// 当我们的thenable状态变为结束状态时，要执行这个ping
		// Thenable和Wakeable都是指一个包装好的promise，但是Thenable是初始状态，Wakeable是执行结束的状态
		const wakeable: Wakeable<any> = value;

		const suspendeBoundary = getSuspeseHandler();
		if (suspendeBoundary) {
			suspendeBoundary.flags |= ShouldCapture;
		}
		attachPingListener(root, wakeable, lane);
	}
}

function attachPingListener(
	root: FiberRootNode,
	wakeable: Wakeable<any>,
	lane: Lane
) {
	let pingCache = root.pingCache;
	let threadIDs: Set<Lane> | undefined;
	if (pingCache === null) {
		// 没有缓存的话
		threadIDs = new Set<Lane>();
		pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
		pingCache.set(wakeable, threadIDs);
	} else {
		threadIDs = pingCache.get(wakeable);
		if (threadIDs === undefined) {
			threadIDs = new Set<Lane>();
			pingCache.set(wakeable, threadIDs);
		}
	}

	if (!threadIDs.has(lane)) {
		// 第一次进入
		threadIDs.add(lane);
		/**
		 *
		 * 这么写的话，多次进入attachPingListener，只有第一次会执行wakeable.then
		 */
		function ping() {
			if (pingCache !== null) {
				pingCache.delete(wakeable);
			}
			markRootPinged(root, lane);
			markRootUpdated(root, lane);
			ensureRootIsScheduled(root);
		}
		wakeable.then(ping, ping);
	}
}
