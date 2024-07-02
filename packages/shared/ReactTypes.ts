export type ElementType = any;
export type Key = any;
export type Ref = { current: any } | ((instance: any) => void);
export type Props = any;
export interface ReactElementType {
	$$typeof: symbol | number;
	type: ElementType;
	key: Key;
	props: Props;
	ref: Ref;
	__mark: string;
}

export type Action<State> = State | ((prevState: State) => State);

export type ReactContext<T> = {
	$$typeof: symbol | number;
	Provider: ReactProviderType<T> | null;
	_currentValue: T;
};

export type ReactProviderType<T> = {
	$$typeof: symbol | number;
	_context: ReactContext<T> | null;
};

export type Usable<T> = Thenable<T> | ReactContext<T>;

// thenable有四种状态，
/**
 * untracked
 * pending
 * fulfilled -> resolve
 * rejected -> reject
 * 用户传进来一个promise，use接收到之后我们把他包装成一个thenable
 */

export interface Wakeable<Result> {
	then(
		onFulfilled: () => Result,
		onRejected: () => Result
	): void | Wakeable<Result>;
}
export interface ThenableImpl<T, Result, Err> {
	then(
		onFulfilled: (value: T) => Result,
		onRejected: (error: Err) => Err
	): void | Wakeable<Result>;
}

export interface UntrackedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status?: void;
}

export interface PendingThenable<T, Result, Err> extends ThenableImpl<T, Result, Err> {
	status: 'pending';
}

export interface FulfilledThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'fulfilled';
	value: T;
}

export interface RejectedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'rejected';
	reason: Err;
}

export type Thenable<T, Result = void, Err = any> =
	| UntrackedThenable<T, Result, Err>
	| PendingThenable<T, Result, Err>
	| FulfilledThenable<T, Result, Err>
	| RejectedThenable<T, Result, Err>;
