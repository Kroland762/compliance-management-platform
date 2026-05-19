import ProblemAccount from './ProblemAccount';
import AccountData from './AccountData';
import AuditRule from './AuditRule';

ProblemAccount.belongsTo(AccountData, { foreignKey: 'accountDataId', as: 'AccountDatum' });
ProblemAccount.belongsTo(AuditRule, { foreignKey: 'ruleId', as: 'AuditRule' });
AccountData.hasMany(ProblemAccount, { foreignKey: 'accountDataId' });
AuditRule.hasMany(ProblemAccount, { foreignKey: 'ruleId' });
