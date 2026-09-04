import React from "react";
import Applicant from "./Applicant";
import CurrentStatus from "./CurrentStatus";
import { Link } from "react-router-dom";

const ApplicantList = ({ applicants }) => {
    return (
        <>
            {applicants
                ? applicants.map((application) => (
                      <ul key={application.user_id}>
                          <Applicant user={application.user} />
                          <CurrentStatus status={application.status} />
                          <Link to={`/applications/${application.id}`}>
                              Manage Application
                          </Link>
                      </ul>
                  ))
                : "Loading Applicants"}
        </>
    );
};

export default ApplicantList;
