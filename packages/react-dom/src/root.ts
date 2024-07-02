import {
	createContainer,
	updateContainer
} from '../../react-reconciler/src/fiberReconciler';
import { ReactElementType } from '../../shared/ReactTypes';
import { initEvent } from './SyntheticEvent';
import { Container } from './hostConfig';

export function createRoot(container: Container) {
	const root = createContainer(container);
	return {
		render(element: ReactElementType) {
			initEvent(container, 'click');
			updateContainer(element, root);
		}
	};
}
