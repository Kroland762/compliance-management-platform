import ProblemAccount from './ProblemAccount';
import AccountData from './AccountData';
import AuditRule from './AuditRule';
import ProblemStatusHistory from './ProblemStatusHistory';

ProblemAccount.belongsTo(AccountData, { foreignKey: 'accountDataId', as: 'AccountDatum' });
ProblemAccount.belongsTo(AuditRule, { foreignKey: 'ruleId', as: 'AuditRule' });
AccountData.hasMany(ProblemAccount, { foreignKey: 'accountDataId' });
AuditRule.hasMany(ProblemAccount, { foreignKey: 'ruleId' });
ProblemAccount.hasMany(ProblemStatusHistory, { foreignKey: 'problemId', as: 'statusHistory', onDelete: 'CASCADE' });
ProblemStatusHistory.belongsTo(ProblemAccount, { foreignKey: 'problemId', as: 'problem' });
