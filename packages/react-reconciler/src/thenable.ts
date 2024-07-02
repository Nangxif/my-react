import {
	FulfilledThenable,
	PendingThenable,
	RejectedThenable,
	Thenable
} from 'shared/ReactTypes';

export const SuspenseException = new Error(
	'这不是真实的错误，这是Suspense工作的一部分，如果你捕获到这个错误，请将他继续抛出去'
);

// 当前抛出错误的thenable
let suspendedThenable: Thenable<any> | null = null;

export function getSuspeseThenable(): Thenable<any> {
	if (suspendedThenable === null) {
		throw new Error('应该存在suspendedThenable，这是个bug');
	}
	const thenable = suspendedThenable;
	suspendedThenable = null;
	return thenable;
}
// 什么都不干
function noop() {}
// 将一个promise包装成thenable，当这个promise状态变为结束的时候就变成wakeble
export function trackUsedThenable<T>(thenable: Thenable<T>) {
	// 用户传进来的promise肯定没有status这个字段，所以应该进入default
	switch (thenable.status) {
		case 'fulfilled':
			return thenable.value;
		case 'rejected':
			throw thenable.reason;
		default:
			if (typeof thenable.status === 'string') {
				// 如果等于string说明这个promise已经进来过了，我们已经把他包装成了thenable，否则不可能有status这个字段
				thenable.then(noop, noop);
			} else {
				// untracked状态
				// pending
				const pending = thenable as unknown as PendingThenable<T, void, any>;
				pending.status = 'pending';
				pending.then(
					(val) => {
						if (pending.status === 'pending') {
							// 从pending变成resolve
							// @ts-ignore
							const fulfilled: FulfilledThenable<T, void, any> = pending;
							fulfilled.status = 'fulfilled';
							fulfilled.value = val;
						}
					},
					(err) => {
						if (pending.status === 'pending') {
							// 从pending变成resolve
							// @ts-ignore
							const rejected: RejectedThenable<T, void, any> = pending;
							rejected.status = 'rejected';
							rejected.reason = err;
						}
					}
				);
			}
			break;
	}
	/**
	 * 我们正常的function Component执行的时候，怎么在遇到use的时候可以打断这个流程呢，方法就是抛出一个错误
	 */
	// throw thenable;但是这么直接抛出的话不够优雅
	suspendedThenable = thenable;
	throw SuspenseException;
}
