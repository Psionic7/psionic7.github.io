import React,{useSyncExternalStore} from 'react';
import {preferenceStorageProblem,subscribePreferenceStorage} from './preferences.js';
export default function StorageNotice(){
  const message=useSyncExternalStore(subscribePreferenceStorage,preferenceStorageProblem,()=>'');
  return message?<p className="notice error storage-notice" role="alert">{message}</p>:null;
}
