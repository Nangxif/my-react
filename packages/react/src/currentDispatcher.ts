import { Action, ReactContext, Usable } from 'shared/ReactTypes';

export interface Dispatcher {
	useState: <T>(initialState: (() => T) | T) => [T, Dispatch<T>];
	useEffect: (callback: () => void | void, deps: any[] | void) => void;
	useTransition: () => [boolean, (callback: () => void) => void];
	useRef: <T>(initialValue: T) => { current: T };
	useContext: <T>(context: ReactContext<T>) => T;
	use: <T>(usable: Usable<T>) => T;
}

export type Dispatch<State> = (action: Action<State>) => void;

const currentDispatcher: { current: Dispatcher | null } = {
	current: null
};

// 定义一个方法，更容易获取dispatcher里面的hook
export const resolveDispatcher = (): Dispatcher => {
	const dispatcher = currentDispatcher.current;
	// 如果没有在函数组件中执行，那么dispatcher是不会被赋值的
	if (dispatcher === null) {
		throw new Error('hook只能在函数组件中执行');
	}
	return dispatcher;
};
export default currentDispatcher;
