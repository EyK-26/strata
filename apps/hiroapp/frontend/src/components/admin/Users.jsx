import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import SearchBar from "../SeachBar";
import SelectDepartment from "./SelectDepartment";
import Pagination from "../Pagination";

const Users = () => {
	const [users, setUsers] = useState([]);
	const [search, setSearch] = useState("");
	const [department, setDepartment] = useState(0);
	const [page, setPage] = useState(1);
	const lastPage = Math.floor(users.length / 20) + 1;
	const startResults = 20 * (page - 1);
	const location = useLocation();
	const { userDeleted } = location.state || false;

	const fetchUsers = async () => {
		try {
			const response = await axios.get(
				"/api/users?search=" + search + "&department=" + department
			);
			setUsers(response.data);
		} catch (error) {
			console.log(error.response.data);
		}
	};

	useEffect(() => {
		fetchUsers();
		setPage(1);
	}, [search, department]);

	return (
		<div>
			{userDeleted && <p>User deleted successfully!</p>}
			<Link to="/users">
				<h2>Active Users</h2>
			</Link>
			<div>
				<SearchBar subject="a user" setSearch={setSearch} />
				<SelectDepartment
					department={department}
					setDepartment={setDepartment}
				/>
			</div>
			{users.length > 20 ? (
				<div>
					<Pagination page={page} setPage={setPage} lastPage={lastPage} />{" "}
				</div>
			) : (
				<div className="pagination-hidden">
					<Pagination page={page} setPage={setPage} lastPage={lastPage} />{" "}
				</div>
			)}

			<div className="list">
				{users.slice(startResults, startResults + 20).map((user) => (
					<div key={user.id}>
						<Link to={"/users/" + user.id} key={user.id} className="list-item">
							<span>
								{user.first_name} {user.last_name}
							</span>
						</Link>
						<span>Position: {user.position?.name}</span>
						<span>Department: {user.position?.department?.name}</span>
					</div>
				))}
			</div>
		</div>
	);
};

export default Users;
