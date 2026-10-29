import { lazy } from 'react'

// The working screens load after the splash and sign-in, which then appear sooner; preloadScreens fetches them in the background.
const loadSageModules = () => import('../SageModules')
const loadFinanceSections = () => import('../FinanceSections')
export const SageModules = lazy(() => loadSageModules().then((module) => ({ default: module.SageModules })))
export const FinanceView = lazy(() => loadFinanceSections().then((module) => ({ default: module.FinanceView })))
export const preloadScreens = () => Promise.all([loadSageModules(), loadFinanceSections()]).catch(() => undefined)
