import {configure} from '@testing-library/react';
// Cold lazy imports are transformed by Vite in jsdom. Their setup time varies
// with worker contention; assertions still run as soon as the UI is ready.
configure({asyncUtilTimeout:3000});
